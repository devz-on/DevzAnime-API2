import { NotFoundError, validationError } from '../utils/errors.js';
import {
  loadAnimeDetails,
  loadCatalog,
  resolveEpisode,
  toLegacyEpisodeId,
} from './catalog.js';
import {
  extractNumericSuffix,
  isLikelyDirectMediaUrl,
  mediaTypeForUrl,
  parseAired,
  SERVER_NAMES,
  slugify,
  toBasicAnime,
  toExploreAnime,
  toNumber,
  toSafeString,
} from './normalizers.js';
import { buildProxyUrl, fetchJikan, fetchJsonWithFallback, getProviderConfig, probeUrl } from './upstream.js';

function buildServerItems(urls, type) {
  const list = Array.isArray(urls) ? urls : [];
  return list.slice(0, SERVER_NAMES.length).map((url, index) => {
    const numericId = toNumber(String(url).match(/\/(\d+)(?:\/|$)/)?.[1], index + 1);
    return {
      index: index + 1,
      type,
      id: numericId,
      name: SERVER_NAMES[index],
      _url: String(url),
    };
  });
}

async function pickStreamUrlWithFallback(url, c) {
  const config = getProviderConfig(c);
  const candidates = [
    url,
    buildProxyUrl(config.m3u8ProxyUrl, url, config.hianimesReferer),
    buildProxyUrl(config.daniProxyUrl, url, config.hianimesReferer),
  ].filter(Boolean);

  for (const candidate of candidates) {
    // HEAD succeeds for many direct urls, and 405 usually still means URL is valid for GET.
    const ok = await probeUrl(candidate);
    if (ok) {
      return candidate;
    }
  }

  return candidates[0] || url;
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEmbeddedStreamUrl(url) {
  try {
    const parsed = new URL(url);
    const sourceMatch = parsed.pathname.match(/\/stream\/s-\d+\/([^/?#]+)(?:\/|$)/i);
    if (!sourceMatch?.[1]) {
      return null;
    }

    return {
      origin: parsed.origin,
      sourceId: sourceMatch[1],
      referer: `${parsed.origin}/`,
    };
  } catch {
    return null;
  }
}

function extractStreamFileFromSources(sources) {
  if (Array.isArray(sources)) {
    const first = sources.find((item) => item && typeof item.file === 'string');
    return first?.file || '';
  }

  if (sources && typeof sources === 'object' && typeof sources.file === 'string') {
    return sources.file;
  }

  if (typeof sources === 'string' && /^https?:\/\//i.test(sources)) {
    return sources;
  }

  return '';
}

function normalizeTracks(rawTracks) {
  if (!Array.isArray(rawTracks)) {
    return [];
  }

  return rawTracks
    .map((track) => {
      if (!track || typeof track !== 'object') {
        return null;
      }

      const file = toSafeString(track.file);
      if (!file) {
        return null;
      }

      return {
        file,
        label: toSafeString(track.label) || 'Subtitle',
        kind: toSafeString(track.kind) || 'captions',
        default: Boolean(track.default),
      };
    })
    .filter(Boolean);
}

function normalizeStreamWindow(rawWindow) {
  return {
    start: toFiniteNumber(rawWindow?.start, 0),
    end: toFiniteNumber(rawWindow?.end, 0),
  };
}

async function resolveEmbeddedStreamData(selectedUrl, selectedName, normalizedType, id, c) {
  const embedded = parseEmbeddedStreamUrl(selectedUrl);
  if (!embedded) {
    return null;
  }

  const getSourcesUrl = `${embedded.origin}/stream/getSources?id=${encodeURIComponent(embedded.sourceId)}`;

  try {
    const payload = await fetchJsonWithFallback(getSourcesUrl, c, embedded.referer);
    const sourceFile = extractStreamFileFromSources(payload?.sources);
    if (!sourceFile) {
      return null;
    }

    return [
      {
        id,
        type: normalizedType,
        link: {
          file: sourceFile,
          type: mediaTypeForUrl(sourceFile),
        },
        tracks: normalizeTracks(payload?.tracks),
        intro: normalizeStreamWindow(payload?.intro),
        outro: normalizeStreamWindow(payload?.outro),
        server: selectedName,
        referer: embedded.referer,
      },
    ];
  } catch {
    return null;
  }
}

export async function getAnimeInfoData(id, c) {
  const { anime, episodes } = await loadAnimeDetails(id, c);
  const catalog = await loadCatalog(c);
  const popular = [...catalog].sort((a, b) => a.__popularity - b.__popularity).slice(0, 12);
  const recommended = [...catalog]
    .filter((entry) => entry.__id !== anime.__id)
    .sort((a, b) => b.__score - a.__score)
    .slice(0, 12);

  const aired = parseAired(anime?.Aired);
  return {
    ...toBasicAnime(anime),
    rating: toSafeString(anime?.Rating || ''),
    type: toSafeString(anime?.Type || 'TV'),
    is18Plus: toSafeString(anime?.Rating).toLowerCase().startsWith('r'),
    synopsis: toSafeString(anime?.synopsis || ''),
    synonyms: toSafeString(anime?.alternateTitle || ''),
    aired,
    premiered: toSafeString(anime?.Premiered || ''),
    duration: toSafeString(anime?.Duration || ''),
    status: toSafeString(anime?.Status || ''),
    MAL_score: toSafeString(anime?.Score || anime?.score || ''),
    genres: Array.isArray(anime?.genres) ? anime.genres : [],
    studios: toSafeString(anime?.Licensors)
      .split(',')
      .map((value) => toSafeString(value))
      .filter(Boolean),
    producers: toSafeString(anime?.Producers)
      .split(',')
      .map((value) => slugify(value))
      .filter(Boolean),
    related: [],
    mostPopular: popular.map((entry) => toBasicAnime(entry)),
    recommended: recommended.map((entry) => ({
      ...toExploreAnime(entry),
      is18Plus: toSafeString(entry?.Rating).toLowerCase().startsWith('r'),
    })),
    _episodesRaw: episodes,
  };
}

export async function getRandomAnimeInfoData(c) {
  const catalog = await loadCatalog(c);
  if (catalog.length < 1) {
    throw new NotFoundError('no anime found');
  }
  const randomEntry = catalog[Math.floor(Math.random() * catalog.length)];
  return getAnimeInfoData(randomEntry.__id, c);
}

export async function getEpisodesData(id, c) {
  const { anime, episodes } = await loadAnimeDetails(id, c);
  return episodes.map((episode, index) => ({
    title: toSafeString(episode?.title || `Episode ${episode?.episodeNumber || index + 1}`),
    alternativeTitle: toSafeString(episode?.title || `Episode ${episode?.episodeNumber || index + 1}`),
    id: toLegacyEpisodeId(anime.__id, episode),
    isFiller: false,
    episodeNumber: toNumber(episode?.episodeNumber, index + 1),
  }));
}

export async function getServersData(episodeId, c) {
  const { episode } = await resolveEpisode(episodeId, c);
  const sub = buildServerItems(episode?.link?.sub, 'sub');
  const dub = buildServerItems(episode?.link?.dub, 'dub');
  return {
    episode: toNumber(episode?.episodeNumber, 0),
    sub: sub.map((server) => ({
      index: server.index,
      type: server.type,
      id: server.id,
      name: server.name,
    })),
    dub: dub.map((server) => ({
      index: server.index,
      type: server.type,
      id: server.id,
      name: server.name,
    })),
    _subRaw: sub,
    _dubRaw: dub,
  };
}

export async function getStreamData(id, serverName, type, c) {
  const servers = await getServersData(id, c);
  const normalizedServerName = toSafeString(serverName || 'hd-1').toLowerCase();
  const normalizedType = toSafeString(type || 'sub').toLowerCase() === 'dub' ? 'dub' : 'sub';

  const sourceList = normalizedType === 'dub' ? servers._dubRaw : servers._subRaw;
  const selected = sourceList.find((entry) => entry.name === normalizedServerName) || sourceList[0];
  if (!selected) {
    throw new NotFoundError('stream source not found');
  }

  const selectedUrlRaw = toSafeString(selected._url);
  if (!selectedUrlRaw) {
    throw new validationError('invalid stream source url');
  }

  if (isLikelyDirectMediaUrl(selectedUrlRaw)) {
    const selectedUrl = await pickStreamUrlWithFallback(selectedUrlRaw, c);
    return [
      {
        id,
        type: normalizedType,
        link: {
          file: selectedUrl,
          type: mediaTypeForUrl(selectedUrl),
        },
        tracks: [],
        intro: { start: 0, end: 0 },
        outro: { start: 0, end: 0 },
        server: selected.name,
        referer: getProviderConfig(c).hianimesReferer,
      },
    ];
  }

  const resolvedStream = await resolveEmbeddedStreamData(
    selectedUrlRaw,
    selected.name,
    normalizedType,
    id,
    c
  );
  if (resolvedStream) {
    return resolvedStream;
  }

  throw new validationError('unable to resolve stream to direct media source', {
    id,
    server: selected.name,
    type: normalizedType,
  });
}

export async function getCharactersData(id, page, c) {
  const { anime } = await loadAnimeDetails(id, c);
  const malId = toNumber(anime?.mal_id, 0);
  if (!malId) {
    return {
      pageInfo: {
        currentPage: 1,
        totalPages: 1,
        hasNextPage: false,
      },
      response: [],
    };
  }

  const payload = await fetchJikan(`/anime/${malId}/characters`, c, { page });
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const pagination = payload?.pagination || {};

  return {
    pageInfo: {
      currentPage: toNumber(pagination?.current_page, page),
      totalPages: Math.max(1, toNumber(pagination?.last_visible_page, 1)),
      hasNextPage: Boolean(pagination?.has_next_page),
    },
    response: data.map((entry) => {
      const character = entry?.character || {};
      const voiceActors = Array.isArray(entry?.voice_actors) ? entry.voice_actors : [];
      const charNameSlug = slugify(character?.name || 'character');
      return {
        name: toSafeString(character?.name),
        id: `character:${charNameSlug}-${toNumber(character?.mal_id, 0)}`,
        imageUrl:
          toSafeString(character?.images?.jpg?.image_url) ||
          toSafeString(character?.images?.webp?.image_url),
        role: toSafeString(entry?.role || ''),
        voiceActors: voiceActors.map((actor) => {
          const person = actor?.person || {};
          const personNameSlug = slugify(person?.name || 'person');
          return {
            name: toSafeString(person?.name),
            id: `people:${personNameSlug}-${toNumber(person?.mal_id, 0)}`,
            imageUrl:
              toSafeString(person?.images?.jpg?.image_url) ||
              toSafeString(person?.images?.webp?.image_url),
            cast: toSafeString(actor?.language) || null,
          };
        }),
      };
    }),
  };
}

export async function getCharacterData(id, c) {
  const charId = extractNumericSuffix(id);
  if (!charId) {
    throw new validationError('invalid character id');
  }
  const payload = await fetchJikan(`/characters/${charId}/full`, c);
  const character = payload?.data || {};
  const animeAppearances = Array.isArray(character?.anime) ? character.anime : [];

  return {
    name: toSafeString(character?.name),
    type: 'Character',
    japanese: toSafeString(character?.name_kanji),
    imageUrl:
      toSafeString(character?.images?.jpg?.image_url) || toSafeString(character?.images?.webp?.image_url),
    bio: toSafeString(character?.about),
    animeApearances: animeAppearances.map((entry) => {
      const anime = entry?.anime || {};
      const role = toSafeString(entry?.role);
      const animeId = `${slugify(anime?.title || 'anime')}-${toNumber(anime?.mal_id, 0)}`;
      return {
        title: toSafeString(anime?.title),
        alternativeTitle: toSafeString(anime?.title),
        id: animeId,
        poster: toSafeString(anime?.images?.jpg?.image_url),
        role,
        type: role || 'Unknown',
      };
    }),
  };
}

export async function getActorData(id, c) {
  const actorId = extractNumericSuffix(id);
  if (!actorId) {
    throw new validationError('invalid actor id');
  }
  const payload = await fetchJikan(`/people/${actorId}/full`, c);
  const person = payload?.data || {};
  const voices = Array.isArray(person?.voices) ? person.voices : [];

  return {
    name: toSafeString(person?.name),
    type: 'Person',
    japanese: toSafeString(person?.name_kanji),
    imageUrl: toSafeString(person?.images?.jpg?.image_url),
    bio: toSafeString(person?.about),
    voiceActingRoles: voices.map((entry) => {
      const anime = entry?.anime || {};
      const title = toSafeString(anime?.title);
      return {
        title,
        poster: toSafeString(anime?.images?.jpg?.image_url),
        id: `${slugify(title || 'anime')}-${toNumber(anime?.mal_id, 0)}`,
        typeAndYear: toSafeString(entry?.character?.name) || 'Voice Role',
      };
    }),
  };
}

export async function getNextScheduleData(id, c) {
  const { anime, episodes } = await loadAnimeDetails(id, c);
  const catalog = await loadCatalog(c);
  const match = catalog.find((entry) => entry.__id === anime.__id) || anime;
  const totalEpisodes = Math.max(toNumber(match?.totalEpisodes, 0), episodes.length);
  if (totalEpisodes <= episodes.length && totalEpisodes > 0) {
    return { time: null };
  }
  return { time: toSafeString(anime?.Aired || '') || null };
}

export function isValidExploreQuery(query) {
  const known = new Set([
    'top-airing',
    'most-popular',
    'most-favorite',
    'completed',
    'recently-added',
    'recently-updated',
    'top-upcoming',
    'subbed-anime',
    'dubbed-anime',
    'movie',
    'tv',
    'ova',
    'ona',
    'special',
  ]);
  return known.has(toSafeString(query).toLowerCase());
}

import { NotFoundError } from '../utils/errors.js';
import { getHindiDubbedSearchData } from './desiDub.js';
import { getHindiDubbedAnimeDetailsData, getHindiDubbedStreamData } from './desiDubStream.js';
import { toNumber, toSafeString } from './normalizers.js';

const NORMAL_SERVER_NAMES = new Set(['hd-1', 'hd-2', 'hd-3', 'megaplay', 'vidwish']);

function toEpisodeNumber(value) {
  const parsed = Math.max(0, toNumber(value, 0));
  return Number.isFinite(parsed) ? parsed : 0;
}

function decodePathValue(value) {
  const safeValue = toSafeString(value);
  if (!safeValue) return '';
  try {
    return decodeURIComponent(safeValue);
  } catch {
    return safeValue;
  }
}

function parseHindiEpisodeKey(value) {
  const match = decodePathValue(value).match(/^desidub-ep-(\d+)-(\d+)$/i);
  if (!match) {
    return null;
  }
  return {
    animeInput: toSafeString(match[1]),
    episode: toEpisodeNumber(match[2]),
  };
}

function parseSlugStyleEpisodeKey(value) {
  const decoded = decodePathValue(value);
  const match = decoded.match(/^desidub-(\d+)-[a-z0-9-]*?(?:-|_)(?:ep|episode)(?:-|_)?(\d+)$/i);
  if (!match) {
    return null;
  }

  const animePostId = toSafeString(match[1]);
  if (!animePostId) {
    return null;
  }

  return {
    animeInput: animePostId,
    episode: toEpisodeNumber(match[2]),
  };
}

function parseLegacyEpisodeKey(value) {
  const decoded = decodePathValue(value);
  const match = decoded.match(/^(.*)::ep=(.*)$/);
  if (!match) {
    return null;
  }

  const animeInput = toSafeString(match[1]);
  const episode = toEpisodeNumber(match[2]);
  if (!animeInput) {
    return null;
  }

  return {
    animeInput,
    episode,
  };
}

function resolveHindiEpisodeTarget(value) {
  const fromHindiEpisodeId = parseHindiEpisodeKey(value);
  if (fromHindiEpisodeId) {
    return fromHindiEpisodeId;
  }

  const fromSlugStyleEpisodeId = parseSlugStyleEpisodeKey(value);
  if (fromSlugStyleEpisodeId) {
    return fromSlugStyleEpisodeId;
  }

  const fromLegacyEpisodeId = parseLegacyEpisodeKey(value);
  if (fromLegacyEpisodeId) {
    return fromLegacyEpisodeId;
  }

  return {
    animeInput: decodePathValue(value),
    episode: 0,
  };
}

function toEpisodeRowsFromHindiDetails(details) {
  const rows = Array.isArray(details?.episodeList) ? details.episodeList : [];
  if (rows.length < 1) {
    throw new NotFoundError('episode not found');
  }

  return rows.map((item, index) => {
    const episodeNumber = toEpisodeNumber(item?.episodeNumber || index + 1);
    const title = toSafeString(item?.title) || `Episode ${episodeNumber || index + 1}`;
    return {
      title,
      alternativeTitle: title,
      id: toSafeString(item?.id),
      isFiller: false,
      episodeNumber,
    };
  });
}

function dedupeServerNames(streams) {
  const rows = Array.isArray(streams) ? streams : [];
  const seen = new Set();
  const servers = [];

  rows.forEach((stream) => {
    const serverName = toSafeString(stream?.server).toLowerCase() || 'hindi';
    if (!serverName || seen.has(serverName)) {
      return;
    }
    seen.add(serverName);
    servers.push(serverName);
  });

  if (servers.length < 1) {
    servers.push('hindi');
  }

  return servers;
}

function toServersFromHindiStream(payload, fallbackEpisode = 0) {
  const episode = toEpisodeNumber(payload?.episode?.number || fallbackEpisode);
  const serverNames = dedupeServerNames(payload?.streams);
  return {
    episode,
    sub: [],
    dub: serverNames.map((name, index) => ({
      index: index + 1,
      type: 'dub',
      id: index + 1,
      name,
    })),
  };
}

function normalizeHindiServerInput(server) {
  const normalized = toSafeString(server).toLowerCase();
  if (!normalized) {
    return '';
  }
  if (NORMAL_SERVER_NAMES.has(normalized)) {
    return '';
  }
  return normalized;
}

export function isLikelyHindiAnimeIdentifier(value) {
  const normalized = decodePathValue(value).toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.startsWith('desidub-') || normalized.includes('desidubanime.me');
}

export function isLikelyHindiEpisodeIdentifier(value) {
  const normalized = decodePathValue(value).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (/^desidub-ep-\d+-\d+$/.test(normalized)) {
    return true;
  }
  if (/^desidub-\d+-[a-z0-9-]*?(?:-|_)(?:ep|episode)(?:-|_)?\d+$/.test(normalized)) {
    return true;
  }
  return normalized.includes('::ep=desidub-ep-');
}

export function shouldFallbackToHindiOnError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const statusCode = toNumber(error?.statusCode ?? error?.status, 0);
  if (statusCode === 404) {
    return true;
  }

  if (statusCode !== 400) {
    return false;
  }

  const message = toSafeString(error?.message).toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes('not found') ||
    message.includes('no watch episodes found') ||
    message.includes('stream links not found') ||
    message.includes('stream source not found') ||
    message.includes('unable to resolve stream')
  );
}

export function isSearchResponseEmpty(payload) {
  return !Array.isArray(payload?.response) || payload.response.length < 1;
}

export function isEpisodesResponseEmpty(payload) {
  return !Array.isArray(payload) || payload.length < 1;
}

export function isServersResponseEmpty(payload) {
  const sub = Array.isArray(payload?.sub) ? payload.sub : [];
  const dub = Array.isArray(payload?.dub) ? payload.dub : [];
  return sub.length < 1 && dub.length < 1;
}

export function isStreamResponseEmpty(payload) {
  return !Array.isArray(payload) || payload.length < 1;
}

export async function getHindiSearchFallback(keyword, page, c) {
  const payload = await getHindiDubbedSearchData(keyword, page, c, { allowWarmup: false });
  return {
    pageInfo: payload?.pageInfo || {
      currentPage: Math.max(1, toNumber(page, 1)),
      totalPages: 1,
      hasNextPage: false,
    },
    response: Array.isArray(payload?.response) ? payload.response : [],
  };
}

export async function getHindiAnimeInfoFallback(id, c) {
  const details = await getHindiDubbedAnimeDetailsData(id, c);
  const title = toSafeString(details?.title || details?.alternativeTitle || 'Unknown');
  const alternativeTitle = toSafeString(details?.alternativeTitle || title);
  return {
    title,
    alternativeTitle,
    id: toSafeString(details?.id),
    poster: toSafeString(details?.poster),
    episodes:
      details?.episodes && typeof details.episodes === 'object'
        ? details.episodes
        : { sub: 0, dub: 0, eps: 0 },
    rating: 'N/A',
    type: toSafeString(details?.type || 'TV'),
    is18Plus: false,
    synopsis: toSafeString(details?.synopsis),
    synonyms: '',
    aired: {
      from: '',
      to: '',
    },
    premiered: '',
    duration: toSafeString(details?.duration || 'N/A'),
    status: '',
    MAL_score: '',
    genres: [],
    studios: [],
    producers: [],
    related: [],
    mostPopular: [],
    recommended: [],
    streamId: toSafeString(details?.streamId),
    source: details?.source || null,
  };
}

export async function getHindiEpisodesFallback(id, c) {
  const details = await getHindiDubbedAnimeDetailsData(id, c);
  return toEpisodeRowsFromHindiDetails(details);
}

export async function getHindiServersFallback(id, c) {
  const target = resolveHindiEpisodeTarget(id);
  const payload = await getHindiDubbedStreamData(target.animeInput, target.episode, undefined, c);
  return toServersFromHindiStream(payload, target.episode);
}

export async function getHindiStreamFallback(id, server, c) {
  const target = resolveHindiEpisodeTarget(id);
  const normalizedServer = normalizeHindiServerInput(server);
  const payload = await getHindiDubbedStreamData(
    target.animeInput,
    target.episode,
    normalizedServer || undefined,
    c
  );
  const streams = Array.isArray(payload?.streams) ? payload.streams : [];
  if (streams.length < 1) {
    throw new NotFoundError('stream links not found for requested episode/server');
  }
  return streams;
}

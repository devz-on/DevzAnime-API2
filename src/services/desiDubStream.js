import { load } from 'cheerio';
import { NotFoundError, validationError } from '../utils/errors.js';
import { getCachedCatalog, loadCatalog } from './catalog.js';
import { getHindiDubbedData, getHindiDubbedSearchData, normalizeDesiAnimeRow } from './desiDub.js';
import {
  buildDesiFallbackId,
  decodeHtmlEntities,
  getCatalogMatcherIndex,
  resolveDesiDubMapping,
} from './desiDubMapper.js';
import { isLikelyDirectMediaUrl, mediaTypeForUrl, slugify, toNumber, toSafeString } from './normalizers.js';
import { fetchJsonWithMeta, fetchTextWithFallback, getProviderConfig } from './upstream.js';

const MAX_LOOKUP_PAGES = 6;
const MAX_SEARCH_HINTS = 2;

function decodeBase64(value) {
  const input = toSafeString(value);
  if (!input) return '';
  try {
    return Buffer.from(input, 'base64').toString('utf8').trim();
  } catch {
    return '';
  }
}

function toAbsoluteUrl(value, baseUrl) {
  const input = toSafeString(value);
  if (!input) return '';
  try {
    return new URL(input, baseUrl).toString();
  } catch {
    return '';
  }
}

function parseFallbackPostId(value) {
  const match = toSafeString(value).match(/^desidub-(\d+)(?:-[a-z0-9-]+)?$/i);
  return match?.[1] ? toNumber(match[1], 0) : 0;
}

function parseNumericPostId(value) {
  const input = toSafeString(value);
  if (!/^\d+$/.test(input)) return 0;
  return toNumber(input, 0);
}

function parseInputSlug(value) {
  const input = toSafeString(value);
  if (!input) return '';
  try {
    const parsed = new URL(input);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 1) return '';
    const animeIndex = segments.findIndex((segment) => segment === 'anime');
    if (animeIndex >= 0 && animeIndex + 1 < segments.length) {
      return toSafeString(segments[animeIndex + 1]);
    }
    return toSafeString(segments[segments.length - 1]);
  } catch {
    return input;
  }
}

function parseEpisodeNumberFromUrl(value) {
  const input = toSafeString(value);
  const match = input.match(/episode[-\s]*(\d+)/i);
  return match?.[1] ? toNumber(match[1], 0) : 0;
}

function dedupeBy(values, keyBuilder) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const key = toSafeString(keyBuilder(value)).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

async function fetchAnimePostById(postId, c) {
  if (postId <= 0) return null;
  const config = getProviderConfig(c);
  const endpoint = `${config.desiDubWpApiBaseUrl}/anime/${postId}?_embed=1`;
  try {
    const { payload } = await fetchJsonWithMeta(endpoint, c, config.desiDubSiteBaseUrl);
    return payload && typeof payload === 'object' ? payload : null;
  } catch (error) {
    if (error?.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

async function fetchAnimePostBySlug(slug, c) {
  const safeSlug = toSafeString(slug);
  if (!safeSlug) return null;
  const config = getProviderConfig(c);
  const query = new URLSearchParams({
    slug: safeSlug,
    per_page: '1',
    _embed: '1',
  });
  const endpoint = `${config.desiDubWpApiBaseUrl}/anime?${query.toString()}`;
  const { payload } = await fetchJsonWithMeta(endpoint, c, config.desiDubSiteBaseUrl);
  if (!Array.isArray(payload) || !payload[0]) return null;
  return payload[0];
}

function rowMatchesInput(row, input, postIdHint) {
  const safeInput = toSafeString(input).toLowerCase();
  if (!safeInput || !row || typeof row !== 'object') return false;

  const source = row.mapping?.source || {};
  const sourcePostId = toNumber(source.postId, 0);
  const sourceSlug = toSafeString(source.slug).toLowerCase();
  const rowId = toSafeString(row.id).toLowerCase();
  const streamId = toSafeString(row.streamId).toLowerCase();
  const daniId = toSafeString(row.mapping?.daniId).toLowerCase();

  if (postIdHint > 0 && sourcePostId === postIdHint) return true;
  if (rowId && rowId === safeInput) return true;
  if (streamId && streamId === safeInput) return true;
  if (daniId && daniId === safeInput) return true;
  if (sourceSlug && sourceSlug === safeInput) return true;

  return false;
}

function sourceMatchesInput(source, input, postIdHint) {
  const safeInput = toSafeString(input).toLowerCase();
  if (!safeInput || !source || typeof source !== 'object') return false;

  const sourcePostId = toNumber(source.postId, 0);
  const sourceSlug = toSafeString(source.slug).toLowerCase();
  const fallbackId = toSafeString(buildDesiFallbackId(source)).toLowerCase();
  const sourceUrlSlug = parseInputSlug(source.url).toLowerCase();

  if (postIdHint > 0 && sourcePostId === postIdHint) return true;
  if (sourceSlug && sourceSlug === safeInput) return true;
  if (sourceUrlSlug && sourceUrlSlug === safeInput) return true;
  if (fallbackId && fallbackId === safeInput) return true;

  return false;
}

function buildLookupKeywords(input) {
  const rawInput = toSafeString(input);
  const slugInput = parseInputSlug(rawInput);
  const slugWithoutNumeric = slugInput.replace(/-\d+$/, '');
  const fromSlug = slugWithoutNumeric.replace(/-/g, ' ').trim();
  const fromRaw = rawInput
    .replace(/https?:\/\/[^/]+/i, ' ')
    .replace(/[^\w-]+/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return dedupeBy([fromSlug, fromRaw], (value) => value).filter((value) => value.length >= 3);
}

async function fetchAnimePostFromRow(row, c) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const fallbackPostId = parseFallbackPostId(row.streamId || row.id);
  if (fallbackPostId > 0) {
    const byFallbackId = await fetchAnimePostById(fallbackPostId, c);
    if (byFallbackId) return byFallbackId;
  }

  if (row?.mapping?.source?.postId) {
    const byPostId = await fetchAnimePostById(toNumber(row.mapping.source.postId, 0), c);
    if (byPostId) return byPostId;
  }

  if (row?.mapping?.source?.slug) {
    const bySlug = await fetchAnimePostBySlug(row.mapping.source.slug, c);
    if (bySlug) return bySlug;
  }

  return null;
}

async function findMatchingHindiRowBySearch(input, c) {
  const postIdHint = parseFallbackPostId(input) || parseNumericPostId(input);
  const normalizedInput = toSafeString(input).toLowerCase();
  const lookupKeywords = buildLookupKeywords(input).slice(0, MAX_SEARCH_HINTS);

  for (const keyword of lookupKeywords) {
    let payload = null;
    try {
      payload = await getHindiDubbedSearchData(keyword, 1, false, c);
    } catch {
      payload = null;
    }
    if (!payload) continue;

    const rows = Array.isArray(payload?.response) ? payload.response : [];
    const directMatch = rows.find((row) => rowMatchesInput(row, input, postIdHint));
    if (directMatch) {
      return directMatch;
    }

    const mappedMatch = rows.find(
      (row) => toSafeString(row?.mapping?.daniId).toLowerCase() === normalizedInput
    );
    if (mappedMatch) {
      return mappedMatch;
    }
  }

  return null;
}

async function findMatchingHindiRow(input, c) {
  const postIdHint = parseFallbackPostId(input) || parseNumericPostId(input);
  const firstPage = await getHindiDubbedData(1, false, c);
  const firstRows = Array.isArray(firstPage?.response) ? firstPage.response : [];
  const firstMatch = firstRows.find(
    (row) =>
      rowMatchesInput(row, input, postIdHint) ||
      sourceMatchesInput(row?.mapping?.source, input, postIdHint)
  );
  if (firstMatch) return firstMatch;

  const totalPages = Math.min(
    Math.max(1, toNumber(firstPage?.pageInfo?.totalPages, 1)),
    MAX_LOOKUP_PAGES
  );
  for (let page = 2; page <= totalPages; page += 1) {
    const payload = await getHindiDubbedData(page, false, c);
    const rows = Array.isArray(payload?.response) ? payload.response : [];
    const match = rows.find(
      (row) =>
        rowMatchesInput(row, input, postIdHint) ||
        sourceMatchesInput(row?.mapping?.source, input, postIdHint)
    );
    if (match) {
      return match;
    }
  }

  return null;
}

export async function resolveAnimePostByInput(input, c) {
  const fromFallback = parseFallbackPostId(input);
  if (fromFallback > 0) {
    const post = await fetchAnimePostById(fromFallback, c);
    if (post) return post;
  }

  const fromNumeric = parseNumericPostId(input);
  if (fromNumeric > 0) {
    const post = await fetchAnimePostById(fromNumeric, c);
    if (post) return post;
  }

  const slugInput = parseInputSlug(input);
  if (slugInput) {
    const post = await fetchAnimePostBySlug(slugInput, c);
    if (post) return post;
  }

  const searchMatch = await findMatchingHindiRowBySearch(input, c);
  if (searchMatch) {
    const post = await fetchAnimePostFromRow(searchMatch, c);
    if (post) return post;
  }

  const matchingRow = await findMatchingHindiRow(input, c);
  if (matchingRow) {
    const post = await fetchAnimePostFromRow(matchingRow, c);
    if (post) return post;
  }

  throw new NotFoundError('hindi dubbed anime not found');
}

export function parseAnimeEpisodesFromHtml(html, animeUrl) {
  const $ = load(toSafeString(html));
  const entries = [];

  $('.episode-list-display-box.episode-list-item').each((_, el) => {
    const href = toAbsoluteUrl($(el).attr('href'), animeUrl);
    if (!href || !href.includes('/watch/')) return;

    const numberAttr = toNumber($(el).attr('data-episode-search-query'), 0);
    const number = numberAttr > 0 ? numberAttr : parseEpisodeNumberFromUrl(href);
    const title = decodeHtmlEntities(toSafeString($(el).find('.episode-list-item-title').text()));

    entries.push({
      number,
      title: title || (number > 0 ? `Episode ${number}` : 'Episode'),
      url: href,
      slug: parseInputSlug(href),
    });
  });

  if (entries.length < 1) {
    $('a[href*="/watch/"]').each((_, el) => {
      const href = toAbsoluteUrl($(el).attr('href'), animeUrl);
      if (!href) return;
      const number = parseEpisodeNumberFromUrl(href);
      entries.push({
        number,
        title: number > 0 ? `Episode ${number}` : 'Episode',
        url: href,
        slug: parseInputSlug(href),
      });
    });
  }

  return dedupeBy(entries, (entry) => entry.url).sort((left, right) => {
    const leftNum = toNumber(left.number, 0);
    const rightNum = toNumber(right.number, 0);
    if (leftNum !== rightNum) return leftNum - rightNum;
    return toSafeString(left.url).localeCompare(toSafeString(right.url));
  });
}

function pickEpisode(episodes, requestedEpisode) {
  if (!Array.isArray(episodes) || episodes.length < 1) {
    throw new NotFoundError('no watch episodes found for hindi dubbed anime');
  }

  const targetEpisode = Math.max(0, toNumber(requestedEpisode, 0));
  if (targetEpisode > 0) {
    const found = episodes.find((episode) => toNumber(episode.number, 0) === targetEpisode);
    if (!found) {
      throw new NotFoundError('requested episode not found');
    }
    return found;
  }

  return episodes[episodes.length - 1];
}

function decodeEmbedEntry(rawValue) {
  const raw = toSafeString(rawValue);
  if (!raw || !raw.includes(':')) return null;
  const [serverEncoded, urlEncoded] = raw.split(':');
  const server = toSafeString(decodeBase64(serverEncoded));
  const url = toSafeString(decodeBase64(urlEncoded));
  if (!url) return null;
  return {
    server: server || 'desidub',
    url,
  };
}

function parseRawUrlCandidates(html) {
  const body = toSafeString(html);
  if (!body) return [];
  const rawMatches = [...body.matchAll(/https?:\/\/[^"'\\\s<>]+/gi)].map((match) => match[0]);
  const filtered = rawMatches.filter((value) => {
    const lower = toSafeString(value).toLowerCase();
    if (!lower) return false;
    if (
      lower.includes('/wp-json/oembed') ||
      lower.includes('fonts.googleapis') ||
      lower.includes('reddit.com') ||
      lower.includes('facebook.com') ||
      lower.includes('x.com/intent') ||
      lower.includes('tumblr.com/widgets')
    ) {
      return false;
    }

    const direct = isLikelyDirectMediaUrl(lower);
    try {
      const parsed = new URL(lower);
      if (parsed.hostname.includes('desidubanime.me') && !direct) {
        return false;
      }
    } catch {
      return false;
    }

    return (
      direct ||
      /(embed|player|stream|vidmoly|mirror|wish|abyss|rapid|short\.icu|cloud)/i.test(lower)
    );
  });
  return dedupeBy(filtered, (item) => item);
}

function parseStreamsFromWatchHtml(html, watchUrl) {
  const $ = load(toSafeString(html));
  const streams = [];

  $('[data-embed-id]').each((_, el) => {
    const parsed = decodeEmbedEntry($(el).attr('data-embed-id'));
    if (!parsed?.url) return;
    streams.push({
      server: parsed.server,
      url: toAbsoluteUrl(parsed.url, watchUrl),
    });
  });

  $('.episode-player-box iframe').each((_, el) => {
    const src = toAbsoluteUrl($(el).attr('src'), watchUrl);
    if (!src) return;
    streams.push({
      server: 'default',
      url: src,
    });
  });

  $('video').each((_, el) => {
    const src = toAbsoluteUrl($(el).attr('src'), watchUrl);
    if (!src) return;
    streams.push({
      server: 'video',
      url: src,
    });
  });

  $('source[src]').each((_, el) => {
    const src = toAbsoluteUrl($(el).attr('src'), watchUrl);
    if (!src) return;
    streams.push({
      server: 'source',
      url: src,
    });
  });

  parseRawUrlCandidates(html).forEach((url) => {
    streams.push({
      server: 'raw',
      url: toAbsoluteUrl(url, watchUrl),
    });
  });

  return dedupeBy(streams, (stream) => stream.url).filter((stream) => Boolean(stream.url));
}

function normalizeServerName(value) {
  const text = toSafeString(value);
  const slug = slugify(text);
  return slug || 'desidub';
}

function filterStreamsByServer(streams, server) {
  const safeServer = normalizeServerName(server);
  if (!toSafeString(server)) return streams;
  return streams.filter((stream) => normalizeServerName(stream.server) === safeServer);
}

function toMappingInfo(mapping) {
  return {
    mapped: Boolean(mapping?.mapped),
    daniId: mapping?.daniId || null,
    method: mapping?.method || 'none',
    confidence: toNumber(mapping?.confidence, 0),
  };
}

function getUnmappedMapping() {
  return {
    mapped: false,
    daniId: null,
    method: 'none',
    confidence: 0,
  };
}

function toEpisodeId(postId, episodeNumber) {
  const safePostId = toNumber(postId, 0) || 'unknown';
  const safeEpisode = Math.max(1, toNumber(episodeNumber, 1));
  return `desidub-ep-${safePostId}-${safeEpisode}`;
}

function stripHtml(value) {
  return toSafeString(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function getHindiDubbedAnimeDetailsData(id, c) {
  const inputId = toSafeString(id);
  if (!inputId) {
    throw new validationError('id path parameter is required');
  }

  const animePost = await resolveAnimePostByInput(inputId, c);
  const source = normalizeDesiAnimeRow(animePost);
  if (!source?.url) {
    throw new NotFoundError('anime detail page not found');
  }

  const config = getProviderConfig(c);
  const [animeHtml, catalog] = await Promise.all([
    fetchTextWithFallback(source.url, c, config.desiDubSiteBaseUrl),
    loadCatalog(c),
  ]);

  const episodes = parseAnimeEpisodesFromHtml(animeHtml, source.url);
  const matcherIndex = getCatalogMatcherIndex(catalog);
  const mapping = resolveDesiDubMapping(source, catalog, matcherIndex);
  const streamId = buildDesiFallbackId(source);
  const episodeCount = episodes.length;

  const synopsis =
    stripHtml(animePost?.content?.rendered) ||
    stripHtml(animePost?.excerpt?.rendered) ||
    '';

  return {
    title: source.title || source.slug || 'Unknown',
    alternativeTitle: source.title || source.slug || 'Unknown',
    id: mapping?.mapped ? mapping.daniId : streamId,
    streamId,
    poster: source.poster,
    episodes: {
      sub: 0,
      dub: episodeCount > 0 ? episodeCount : 1,
      eps: episodeCount,
    },
    type: source.type || 'TV',
    duration: source.duration || 'N/A',
    synopsis,
    source: {
      postId: source.postId,
      slug: source.slug,
      url: source.url,
    },
    mapping: toMappingInfo(mapping),
    episodeList: episodes.map((episode) => ({
      id: toEpisodeId(source.postId, episode.number),
      episodeNumber: toNumber(episode.number, 0),
      title: episode.title,
      watchUrl: episode.url,
    })),
  };
}

export async function getHindiDubbedStreamData(id, episode, server, c) {
  const inputId = toSafeString(id);
  if (!inputId) {
    throw new validationError('id query parameter is required');
  }

  const animePost = await resolveAnimePostByInput(inputId, c);
  const source = normalizeDesiAnimeRow(animePost);
  if (!source?.url) {
    throw new NotFoundError('anime watch page not found');
  }

  const config = getProviderConfig(c);
  const animeHtml = await fetchTextWithFallback(source.url, c, config.desiDubSiteBaseUrl);

  const episodes = parseAnimeEpisodesFromHtml(animeHtml, source.url);
  const selectedEpisode = pickEpisode(episodes, episode);
  const watchHtml = await fetchTextWithFallback(selectedEpisode.url, c, config.desiDubSiteBaseUrl);
  const parsedStreams = parseStreamsFromWatchHtml(watchHtml, selectedEpisode.url);
  const filteredStreams = filterStreamsByServer(parsedStreams, server);

  if (filteredStreams.length < 1) {
    throw new NotFoundError('stream links not found for requested episode/server');
  }

  const cachedCatalog = getCachedCatalog(c);
  const mapping = cachedCatalog
    ? resolveDesiDubMapping(source, cachedCatalog, getCatalogMatcherIndex(cachedCatalog))
    : getUnmappedMapping();
  const streamId = buildDesiFallbackId(source);
  const episodeId = toEpisodeId(source.postId, selectedEpisode.number);

  return {
    anime: {
      id: mapping?.mapped ? mapping.daniId : streamId,
      streamId,
      title: source.title,
      postId: source.postId,
      slug: source.slug,
      url: source.url,
      mapping: toMappingInfo(mapping),
    },
    episode: {
      id: episodeId,
      number: toNumber(selectedEpisode.number, 0),
      title: selectedEpisode.title,
      url: selectedEpisode.url,
      totalEpisodes: episodes.length,
    },
    streams: filteredStreams.map((stream) => ({
      id: episodeId,
      type: 'dub',
      link: {
        file: stream.url,
        type: mediaTypeForUrl(stream.url),
      },
      tracks: [],
      intro: { start: 0, end: 0 },
      outro: { start: 0, end: 0 },
      server: normalizeServerName(stream.server),
      referer: `${config.desiDubSiteBaseUrl}/`,
      isDirect: isLikelyDirectMediaUrl(stream.url),
    })),
  };
}

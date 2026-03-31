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
const MAX_AJAX_EPISODE_PAGES = 40;
const MAX_EMBED_RESOLVE_ATTEMPTS = 3;
const MAX_RAW_URL_CANDIDATES = 40;
const EPISODE_CACHE_TTL_MS = 5 * 60 * 1000;
const EPISODE_CACHE_MAX_ENTRIES = 200;
const episodeCache = new Map();
const episodeCacheInFlight = new Map();

function hasExecutionContext(c) {
  try {
    return Boolean(c?.executionCtx);
  } catch {
    return false;
  }
}

function isLikelyWorkerRuntime(c) {
  if (hasExecutionContext(c)) {
    return true;
  }
  const hasWebSocketPair = typeof WebSocketPair !== 'undefined';
  const hasEdgeCache =
    typeof globalThis !== 'undefined' &&
    globalThis?.caches &&
    typeof globalThis.caches === 'object' &&
    Boolean(globalThis.caches.default);
  return hasWebSocketPair && hasEdgeCache;
}

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

function parseEpisodeNumber(value) {
  const parsed = Math.max(0, toNumber(value, 0));
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildWorkerProxyUrl(c, targetUrl, referer) {
  const safeTarget = toSafeString(targetUrl);
  if (!safeTarget) {
    return '';
  }

  try {
    const requestUrl = new URL(c.req.url);
    const apiBasePath = requestUrl.pathname.startsWith('/v1/') ? '/v1' : '/api/v1';
    const params = new URLSearchParams();
    params.set('url', safeTarget);
    if (toSafeString(referer)) {
      params.set('referer', toSafeString(referer));
    }
    return `${apiBasePath}/proxy?${params.toString()}`;
  } catch {
    return safeTarget;
  }
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

function buildEpisodeCacheKey(source) {
  const postId = toNumber(source?.postId, 0);
  if (postId > 0) {
    return `post:${postId}`;
  }
  const slug = toSafeString(source?.slug || parseInputSlug(source?.url)).toLowerCase();
  if (slug) {
    return `slug:${slug}`;
  }
  return '';
}

function readCachedEpisodes(cacheKey) {
  if (!cacheKey) return null;
  const entry = episodeCache.get(cacheKey);
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const ageMs = Date.now() - toNumber(entry.updatedAt, 0);
  if (ageMs > EPISODE_CACHE_TTL_MS) {
    episodeCache.delete(cacheKey);
    return null;
  }
  const episodes = Array.isArray(entry.episodes) ? entry.episodes : [];
  if (episodes.length < 1) {
    return null;
  }
  return episodes;
}

function writeCachedEpisodes(cacheKey, episodes) {
  if (!cacheKey) return;
  const rows = Array.isArray(episodes) ? episodes : [];
  if (rows.length < 1) return;
  episodeCache.set(cacheKey, {
    updatedAt: Date.now(),
    episodes: rows,
  });
  while (episodeCache.size > EPISODE_CACHE_MAX_ENTRIES) {
    const oldestKey = episodeCache.keys().next().value;
    if (!oldestKey) break;
    episodeCache.delete(oldestKey);
  }
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
      payload = await getHindiDubbedSearchData(keyword, 1, false, c, { allowWarmup: false });
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
  const firstPage = await getHindiDubbedData(1, false, c, { allowWarmup: false });
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
    const payload = await getHindiDubbedData(page, false, c, { allowWarmup: false });
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

function extractUrlFromEmbedPayload(payload, watchUrl) {
  const input = toSafeString(payload);
  if (!input) return '';

  if (/^https?:\/\//i.test(input)) {
    return toAbsoluteUrl(input, watchUrl);
  }

  const candidates = [input, decodeHtmlEntities(input)].filter(Boolean);
  for (const value of candidates) {
    const iframeMatch = value.match(/<iframe[^>]+src=['"]([^'"]+)['"]/i);
    if (iframeMatch?.[1]) {
      return toAbsoluteUrl(iframeMatch[1], watchUrl);
    }

    const srcMatch = value.match(/src=['"]([^'"]+)['"]/i);
    if (srcMatch?.[1]) {
      return toAbsoluteUrl(srcMatch[1], watchUrl);
    }

    try {
      const parsed = JSON.parse(value);
      const direct = toSafeString(parsed?.url || parsed?.src || parsed?.file);
      if (direct) {
        return toAbsoluteUrl(direct, watchUrl);
      }
    } catch {
      // best effort only
    }
  }

  return '';
}

function decodeEmbedEntry(rawValue, watchUrl) {
  const raw = toSafeString(rawValue);
  if (!raw || !raw.includes(':')) return null;
  const [serverEncoded, urlEncoded] = raw.split(':');
  const server = toSafeString(decodeBase64(serverEncoded));
  const url = extractUrlFromEmbedPayload(toSafeString(decodeBase64(urlEncoded)), watchUrl);
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
      lower.includes('doubleclick.net') ||
      lower.includes('googlesyndication.com') ||
      lower.includes('googleadservices.com') ||
      lower.includes('adsystem') ||
      lower.includes('adservice') ||
      lower.includes('adnxs.com') ||
      lower.includes('magsrv.com') ||
      lower.includes('popads.net') ||
      lower.includes('propellerads') ||
      lower.includes('adsterra') ||
      lower.includes('adf.ly') ||
      lower.includes('ouo.io') ||
      lower.includes('linkvertise') ||
      lower.includes('/wp-json/oembed') ||
      lower.includes('fonts.googleapis') ||
      lower.includes('fonts.gstatic') ||
      lower.includes('static.cloudflareinsights.com') ||
      lower.includes('googletagmanager.com') ||
      lower.includes('google-analytics.com') ||
      lower.includes('reddit.com') ||
      lower.includes('facebook.com') ||
      lower.includes('x.com/intent') ||
      lower.includes('tumblr.com/widgets') ||
      lower.includes('/wp-content/') ||
      /\.(?:js|css|png|jpe?g|gif|svg|webp|woff2?|ttf|ico)(?:$|\?)/i.test(lower)
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
      /(embed|player|vidmoly|mirror|wish|abyss|rapid|vidcloud|megacloud|gdmirrorbot|playerp2p|mewcdn)/i.test(
        lower
      )
    );
  });
  const deduped = dedupeBy(filtered, (item) => item);
  if (deduped.length <= MAX_RAW_URL_CANDIDATES) {
    return deduped;
  }
  return deduped.slice(0, MAX_RAW_URL_CANDIDATES);
}

function parseDirectMediaUrlsFromText(html, baseUrl) {
  const body = toSafeString(html).replace(/\\\//g, '/');
  if (!body) {
    return [];
  }

  const matches = [...body.matchAll(/https?:\/\/[^'"\\\s<>]+(?:\.m3u8|\.mp4|\.mkv|\.webm|\.mpd)[^'"\\\s<>]*/gi)].map(
    (match) => toAbsoluteUrl(match[0], baseUrl)
  );
  return dedupeBy(matches.filter(Boolean), (item) => item);
}

function canResolveEmbedToDirect(url) {
  const lower = toSafeString(url).toLowerCase();
  return lower.includes('vidmoly.') && lower.includes('/embed');
}

async function resolveEmbedToDirectUrls(embedUrl, referer, c) {
  const html = await fetchTextWithFallback(embedUrl, c, referer);
  return parseDirectMediaUrlsFromText(html, embedUrl);
}

function streamPriority(stream) {
  const url = toSafeString(stream?.url).toLowerCase();
  let score = 0;
  if (isLikelyDirectMediaUrl(url)) {
    score += 100;
  }
  if (url.includes('.m3u8')) {
    score += 20;
  }
  // Some hosts return tokenized links bound to transient ASN/IP; keep them as fallback, not primary.
  if (url.includes('asn=')) {
    score -= 220;
  }
  // Fragment-based links lose context when proxied server-side.
  if (url.includes('#')) {
    score -= 40;
  }
  if (url.includes('/embed')) {
    score -= 10;
  }
  return score;
}

async function buildPlayableStreams(streams, referer, c) {
  const rows = Array.isArray(streams) ? streams : [];
  const output = [];
  let resolveAttempts = 0;

  for (const row of rows) {
    const rawUrl = toAbsoluteUrl(row?.url, referer);
    if (!rawUrl) {
      continue;
    }
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      if (host === 'short.icu' || host.endsWith('.short.icu') || host === 'ouo.io' || host.endsWith('.ouo.io')) {
        continue;
      }
    } catch {
      // best-effort only
    }
    const streamReferer = toSafeString(row?.referer || referer);

    if (
      !isLikelyDirectMediaUrl(rawUrl) &&
      resolveAttempts < MAX_EMBED_RESOLVE_ATTEMPTS &&
      canResolveEmbedToDirect(rawUrl)
    ) {
      resolveAttempts += 1;
      const directUrls = await resolveEmbedToDirectUrls(rawUrl, referer, c).catch(() => []);
      directUrls.forEach((directUrl) => {
        output.push({
          server: row.server,
          url: directUrl,
          referer: rawUrl,
        });
      });
    }

    output.push({
      server: row.server,
      url: rawUrl,
      referer: streamReferer,
    });
  }

  return dedupeBy(output, (stream) => stream.url).sort((left, right) => streamPriority(right) - streamPriority(left));
}

function parseStreamsFromWatchHtml(html, watchUrl) {
  const $ = load(toSafeString(html));
  const streams = [];

  $('[data-embed-id]').each((_, el) => {
    const parsed = decodeEmbedEntry($(el).attr('data-embed-id'), watchUrl);
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

function normalizeEpisodesFromAjaxPayload(payload, siteBaseUrl) {
  const rows = Array.isArray(payload?.data?.episodes) ? payload.data.episodes : [];
  return rows
    .map((row) => {
      const watchUrl = toAbsoluteUrl(row?.url, siteBaseUrl);
      if (!watchUrl || !watchUrl.includes('/watch/')) {
        return null;
      }

      const number =
        parseEpisodeNumber(row?.meta_number) ||
        parseEpisodeNumber(row?.tmdb_fetch_episode) ||
        parseEpisodeNumber(row?.number) ||
        parseEpisodeNumberFromUrl(watchUrl);
      const title = decodeHtmlEntities(
        toSafeString(row?.title || row?.post_title || row?.number || `Episode ${number || '?'}`)
      );

      return {
        number,
        title: title || (number > 0 ? `Episode ${number}` : 'Episode'),
        url: watchUrl,
        slug: parseInputSlug(watchUrl),
      };
    })
    .filter(Boolean);
}

async function fetchAnimeEpisodesViaAjax(postId, c) {
  const safePostId = toNumber(postId, 0);
  if (safePostId <= 0) {
    return [];
  }

  const config = getProviderConfig(c);
  const allEpisodes = [];
  let page = 1;
  let totalPageHint = 0;

  while (page <= MAX_AJAX_EPISODE_PAGES) {
    const query = new URLSearchParams({
      action: 'get_episodes',
      anime_id: String(safePostId),
      page: String(page),
      order: 'desc',
    });
    const endpoint = `${config.desiDubSiteBaseUrl}/wp-admin/admin-ajax.php?${query.toString()}`;
    const { payload } = await fetchJsonWithMeta(endpoint, c, config.desiDubSiteBaseUrl);

    if (!payload || typeof payload !== 'object' || payload?.success === false) {
      break;
    }

    const pageEpisodes = normalizeEpisodesFromAjaxPayload(payload, config.desiDubSiteBaseUrl);
    if (pageEpisodes.length < 1) {
      break;
    }
    allEpisodes.push(...pageEpisodes);

    if (totalPageHint <= 0) {
      totalPageHint = Math.max(0, toNumber(payload?.data?.max_episodes_page, 0));
    }

    if (totalPageHint > 0 && page >= totalPageHint) {
      break;
    }

    page += 1;
  }

  return dedupeBy(allEpisodes, (episode) => episode.url).sort((left, right) => {
    const leftNum = parseEpisodeNumber(left.number);
    const rightNum = parseEpisodeNumber(right.number);
    if (leftNum !== rightNum) return leftNum - rightNum;
    return toSafeString(left.url).localeCompare(toSafeString(right.url));
  });
}

async function loadEpisodesForAnime(source, c) {
  const cacheKey = buildEpisodeCacheKey(source);
  const cached = readCachedEpisodes(cacheKey);
  if (cached) {
    return cached;
  }

  if (cacheKey && episodeCacheInFlight.has(cacheKey)) {
    return episodeCacheInFlight.get(cacheKey);
  }

  const task = (async () => {
    const ajaxEpisodes = await fetchAnimeEpisodesViaAjax(source?.postId, c).catch(() => []);
    if (ajaxEpisodes.length > 0) {
      writeCachedEpisodes(cacheKey, ajaxEpisodes);
      return ajaxEpisodes;
    }

    const config = getProviderConfig(c);
    const animeHtml = await fetchTextWithFallback(source.url, c, config.desiDubSiteBaseUrl);
    const parsed = parseAnimeEpisodesFromHtml(animeHtml, source.url);
    writeCachedEpisodes(cacheKey, parsed);
    return parsed;
  })();

  if (cacheKey) {
    episodeCacheInFlight.set(cacheKey, task);
  }

  try {
    return await task;
  } finally {
    if (cacheKey && episodeCacheInFlight.get(cacheKey) === task) {
      episodeCacheInFlight.delete(cacheKey);
    }
  }
}

function buildWatchEpisodeUrl(source, episodeNumber, siteBaseUrl) {
  const safeEpisode = parseEpisodeNumber(episodeNumber);
  if (safeEpisode <= 0) {
    return '';
  }
  const slug = toSafeString(parseInputSlug(source?.url) || source?.slug);
  if (!slug) {
    return '';
  }
  const safeBaseUrl = toSafeString(siteBaseUrl).replace(/\/+$/, '');
  const target = `${safeBaseUrl}/watch/${slug}-episode-${safeEpisode}/`;
  return toAbsoluteUrl(target, safeBaseUrl);
}

function titleFromSlug(slug) {
  return toSafeString(slug)
    .split('-')
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');
}

function buildSourceFromFallbackInputId(inputId, siteBaseUrl) {
  const match = toSafeString(inputId).match(/^desidub-(\d+)-([a-z0-9-]+)$/i);
  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  const postId = toNumber(match[1], 0);
  const slug = toSafeString(match[2]).toLowerCase();
  if (postId <= 0 || !slug) {
    return null;
  }

  const safeBaseUrl = toSafeString(siteBaseUrl).replace(/\/+$/, '');
  const animeUrl = toAbsoluteUrl(`${safeBaseUrl}/anime/${slug}/`, safeBaseUrl);
  return {
    postId,
    slug,
    title: titleFromSlug(slug) || slug,
    url: animeUrl,
    poster: '',
    type: 'TV',
    duration: 'N/A',
  };
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

  const episodes = await loadEpisodesForAnime(source, c);
  const workerRuntime = isLikelyWorkerRuntime(c);
  const cachedCatalog = getCachedCatalog(c);
  const mappingCatalog =
    cachedCatalog || (!workerRuntime ? await loadCatalog(c) : null);
  const mapping = mappingCatalog
    ? resolveDesiDubMapping(source, mappingCatalog, getCatalogMatcherIndex(mappingCatalog))
    : getUnmappedMapping();
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

  const config = getProviderConfig(c);
  let source = buildSourceFromFallbackInputId(inputId, config.desiDubSiteBaseUrl);
  if (!source) {
    const animePost = await resolveAnimePostByInput(inputId, c);
    source = normalizeDesiAnimeRow(animePost);
  }
  if (!source?.url) {
    throw new NotFoundError('anime watch page not found');
  }

  const requestedEpisode = parseEpisodeNumber(episode);
  let episodes = [];
  let selectedEpisode = null;
  let watchHtml = '';

  const quickWatchUrl = buildWatchEpisodeUrl(source, requestedEpisode, config.desiDubSiteBaseUrl);
  if (quickWatchUrl) {
    const quickWatchHtml = await fetchTextWithFallback(quickWatchUrl, c, config.desiDubSiteBaseUrl).catch(() => '');
    if (quickWatchHtml) {
      const quickParsedStreams = parseStreamsFromWatchHtml(quickWatchHtml, quickWatchUrl);
      if (quickParsedStreams.length > 0) {
        selectedEpisode = {
          number: requestedEpisode,
          title: `Episode ${requestedEpisode}`,
          url: quickWatchUrl,
          slug: parseInputSlug(quickWatchUrl),
        };
        watchHtml = quickWatchHtml;
      }
    }
  }

  if (!selectedEpisode?.url) {
    episodes = await loadEpisodesForAnime(source, c);
    selectedEpisode = pickEpisode(episodes, episode);
    watchHtml = await fetchTextWithFallback(selectedEpisode.url, c, config.desiDubSiteBaseUrl);
  }

  const parsedStreams = parseStreamsFromWatchHtml(watchHtml, selectedEpisode.url);
  const playableStreams = await buildPlayableStreams(parsedStreams, selectedEpisode.url, c);
  const filteredStreams = filterStreamsByServer(playableStreams, server);

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
      totalEpisodes:
        episodes.length > 0
          ? episodes.length
          : Math.max(1, parseEpisodeNumber(selectedEpisode.number || requestedEpisode)),
    },
    streams: filteredStreams.map((stream) => ({
      id: episodeId,
      type: 'dub',
      link: {
        file: (() => {
          const safeReferer = toSafeString(stream.referer || `${config.desiDubSiteBaseUrl}/`);
          return buildWorkerProxyUrl(c, stream.url, safeReferer);
        })(),
        type: isLikelyDirectMediaUrl(stream.url) ? mediaTypeForUrl(stream.url) : 'text/html',
      },
      tracks: [],
      intro: { start: 0, end: 0 },
      outro: { start: 0, end: 0 },
      server: normalizeServerName(stream.server),
      referer: toSafeString(stream.referer || `${config.desiDubSiteBaseUrl}/`),
      isDirect: isLikelyDirectMediaUrl(stream.url),
    })),
  };
}

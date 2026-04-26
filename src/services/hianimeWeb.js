import { load } from 'cheerio';
import homeExtract from '../modules/home/home.extract.js';
import infoExtract from '../modules/info/info.extract.js';
import exploreExtract from '../modules/explore/explore.extract.js';
import { parseLegacyEpisodeId } from './catalog.js';
import { isLikelyDirectMediaUrl, mediaTypeForUrl, toNumber, toSafeString } from './normalizers.js';
import { getProviderConfig } from './upstream.js';
import { NotFoundError, validationError } from '../utils/errors.js';

const FETCH_TIMEOUT_MS = 12_000;
const SESSION_TTL_MS = 4 * 60 * 1000;
const WATCH_CACHE_TTL_MS = 2 * 60 * 1000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const sessionState = {
  origin: '',
  cookie: '',
  expiresAt: 0,
  pending: null,
};

const watchContextCache = new Map();

function now() {
  return Date.now();
}

function normalizeToken(value) {
  return toSafeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function withTimeout(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, {
    ...init,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeout);
  });
}

function getWebOrigin(c) {
  const config = getProviderConfig(c);
  const raw = toSafeString(
    config.hianimesWebBaseUrl || config.hianimesReferer || 'https://hianime.dk'
  );
  try {
    return new URL(raw).origin;
  } catch {
    return 'https://hianime.dk';
  }
}

function extractCookieFromResponse(response) {
  try {
    if (typeof response?.headers?.getSetCookie === 'function') {
      const lines = response.headers.getSetCookie();
      const first = Array.isArray(lines) ? lines[0] : '';
      const pair = String(first || '')
        .split(';')
        .shift();
      return toSafeString(pair);
    }
  } catch {
    // Ignore unsupported runtime path.
  }

  const raw = toSafeString(response?.headers?.get('set-cookie'));
  if (!raw) {
    return '';
  }

  return toSafeString(raw.split(';').shift());
}

function buildHeaders({ origin, referer, isAjax, cookie }) {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: isAjax
      ? 'application/json, text/javascript, */*; q=0.01'
      : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    Referer: referer || `${origin}/home`,
  };

  if (isAjax) {
    headers['X-Requested-With'] = 'XMLHttpRequest';
    headers.Origin = origin;
  }
  if (cookie) {
    headers.Cookie = cookie;
  }

  return headers;
}

function shouldRefreshSession(statusCode) {
  return statusCode === 403 || statusCode === 429 || statusCode === 500;
}

async function initSession(c, forceRefresh = false) {
  const origin = getWebOrigin(c);
  const validSession =
    !forceRefresh &&
    sessionState.origin === origin &&
    sessionState.cookie &&
    sessionState.expiresAt > now();
  if (validSession) {
    return sessionState.cookie;
  }

  if (sessionState.pending) {
    return sessionState.pending;
  }

  sessionState.pending = (async () => {
    const response = await withTimeout(`${origin}/home`, {
      headers: buildHeaders({
        origin,
        referer: `${origin}/`,
        isAjax: false,
        cookie: forceRefresh ? '' : sessionState.cookie,
      }),
    });

    if (!response.ok) {
      throw new validationError(`failed to initialize hianime session (${response.status})`);
    }

    const cookie = extractCookieFromResponse(response);
    if (cookie) {
      sessionState.cookie = cookie;
    }
    sessionState.origin = origin;
    sessionState.expiresAt = now() + SESSION_TTL_MS;
    return sessionState.cookie;
  })();

  try {
    return await sessionState.pending;
  } finally {
    sessionState.pending = null;
  }
}

async function fetchTextWithSession(target, c, options = {}) {
  const origin = getWebOrigin(c);
  const isAbsolute = /^https?:\/\//i.test(target);
  const targetUrl = isAbsolute
    ? target
    : `${origin}${target.startsWith('/') ? target : `/${target}`}`;
  const referer = options.referer || `${origin}/home`;
  const isAjax = Boolean(options.isAjax);
  const attemptFetch = async (forceRefresh) => {
    const cookie = await initSession(c, forceRefresh);
    return withTimeout(targetUrl, {
      headers: buildHeaders({
        origin,
        referer,
        isAjax,
        cookie,
      }),
    });
  };

  let response = await attemptFetch(false);
  if (!response.ok && options.retrySession !== false && shouldRefreshSession(response.status)) {
    response = await attemptFetch(true);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new validationError(`hianime request failed (${response.status})`, {
      statusCode: response.status,
      upstream: targetUrl,
      snippet: toSafeString(text).slice(0, 220) || null,
    });
  }

  return text;
}

async function fetchAjaxJson(path, c, options = {}) {
  const text = await fetchTextWithSession(path, c, {
    ...options,
    isAjax: true,
  });

  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new validationError('hianime ajax returned invalid json');
  }

  const status = Number(payload?.status || 0);
  if (status && status !== 200) {
    const message =
      toSafeString(payload?.message || payload?.result || '') || `hianime ajax failed (${status})`;
    throw new validationError(message, {
      statusCode: status,
      payload,
    });
  }

  return payload;
}

function isInternalErrorPage(html) {
  const body = toSafeString(html);
  return (
    body.includes('An Internal Error Has Occurred') ||
    body.includes('"code": 500') ||
    body.includes('"code":500')
  );
}

function cleanAnimeInput(rawAnimeId) {
  const value = decodeURIComponent(toSafeString(rawAnimeId || ''));
  if (!value) {
    return '';
  }

  const noEpisodePart = value.split('::ep=').shift() || value;
  const asPath = noEpisodePart.replace(/^https?:\/\/[^/]+/i, '');
  const watchSegment = asPath.includes('/watch/')
    ? asPath.split('/watch/').pop()
    : asPath.replace(/^\/+/, '');

  return toSafeString(watchSegment);
}

function findWatchMetaFromHtml(html) {
  const $ = load(html);
  const watchRoot = $('.layout-page-watchtv').first();
  return {
    dataId: toSafeString(watchRoot.attr('data-id')),
    dataUrl: toSafeString(watchRoot.attr('data-url')),
  };
}

function bestSearchKeywordFromSlug(slug) {
  const trimmed = toSafeString(slug);
  if (!trimmed) {
    return '';
  }
  const withoutHashSuffix = trimmed.replace(/-[a-z0-9]{4}$/i, '');
  return withoutHashSuffix.replace(/-/g, ' ').trim();
}

function pickWatchPathFromSearch(html, preferredSlug) {
  const $ = load(`<div id="search-root">${toSafeString(html)}</div>`);
  const paths = $('#search-root')
    .find('a[href^="/watch/"]')
    .map((_, el) => toSafeString($(el).attr('href')))
    .get()
    .filter(Boolean);

  if (paths.length < 1) {
    return '';
  }

  const preferredNorm = normalizeToken(preferredSlug);
  if (!preferredNorm) {
    return paths[0];
  }

  const exact = paths.find((path) => normalizeToken(path.split('/watch/').pop()) === preferredNorm);
  if (exact) {
    return exact;
  }

  const partial = paths.find((path) => normalizeToken(path).includes(preferredNorm));
  return partial || paths[0];
}

async function loadWatchContextBySlug(rawSlug, c) {
  const origin = getWebOrigin(c);
  const slug = cleanAnimeInput(rawSlug);
  if (!slug) {
    throw new validationError('invalid anime id');
  }

  const cacheKey = `${origin}|${slug}`;
  const cached = watchContextCache.get(cacheKey);
  if (cached && cached.expiresAt > now()) {
    return cached.value;
  }

  const tryLoadByWatchPath = async (watchPath) => {
    const watchSlug = toSafeString(watchPath)
      .replace(/^\/watch\//, '')
      .replace(/^\/+/, '');
    const watchUrl = `${origin}/watch/${watchSlug}`;
    const html = await fetchTextWithSession(watchUrl, c, {
      referer: `${origin}/home`,
    });
    if (isInternalErrorPage(html)) {
      throw new NotFoundError('watch page not available');
    }

    const { dataId, dataUrl } = findWatchMetaFromHtml(html);
    if (!dataId) {
      throw new NotFoundError('watch page missing episode metadata');
    }

    return {
      watchSlug,
      watchUrl: dataUrl || watchUrl,
      dataId,
      html,
    };
  };

  let resolved = null;
  try {
    resolved = await tryLoadByWatchPath(slug);
  } catch {
    const searchKeyword = bestSearchKeywordFromSlug(slug);
    const searchPayload = await fetchAjaxJson(
      `/ajax/anime/search?keyword=${encodeURIComponent(searchKeyword || slug)}`,
      c
    );
    const watchPath = pickWatchPathFromSearch(searchPayload?.result?.html, slug);
    if (!watchPath) {
      throw new NotFoundError('anime not found on hianime');
    }
    resolved = await tryLoadByWatchPath(watchPath);
  }

  watchContextCache.set(cacheKey, {
    expiresAt: now() + WATCH_CACHE_TTL_MS,
    value: resolved,
  });

  return resolved;
}

function parseEpisodeRows(episodeHtml, watchSlug) {
  const $ = load(`<div id="episode-root">${toSafeString(episodeHtml)}</div>`);
  const rows = [];

  $('#episode-root')
    .find('.ssl-item.ep-item')
    .each((index, element) => {
      const el = $(element);
      const episodeNumber = toNumber(el.attr('data-num'), index + 1);
      const episodeSlug = toSafeString(el.attr('data-slug') || episodeNumber);
      const title = toSafeString(el.attr('title')) || `Episode ${episodeNumber}`;
      const dataIds = toSafeString(el.attr('data-ids'));
      if (!episodeNumber || !dataIds) {
        return;
      }

      rows.push({
        title,
        alternativeTitle: title,
        episodeNumber,
        slug: episodeSlug,
        dataIds,
        id: `${watchSlug}::ep=${episodeNumber}`,
        isFiller: el.hasClass('ssl-item-filler'),
      });
    });

  return rows;
}

function pickEpisodeRow(rows, episodeRef) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length < 1) {
    return null;
  }

  const ref = toSafeString(episodeRef);
  if (!ref) {
    return list[0];
  }

  const numericRef = Number(ref);
  if (Number.isFinite(numericRef) && numericRef > 0) {
    const byNumber = list.find((entry) => entry.episodeNumber === numericRef);
    if (byNumber) {
      return byNumber;
    }
  }

  const bySlug = list.find((entry) => entry.slug === ref);
  return bySlug || list[0];
}

function normalizeServerType(rawType) {
  return toSafeString(rawType).toLowerCase().includes('dub') ? 'dub' : 'sub';
}

function parseServerRows(serverHtml, watchUrl) {
  const $ = load(`<div id="server-root">${toSafeString(serverHtml)}</div>`);
  const counters = {
    sub: 0,
    dub: 0,
  };
  const subRaw = [];
  const dubRaw = [];

  $('#server-root')
    .find('.server-item a[data-link-id]')
    .each((_, element) => {
      const el = $(element);
      const rawType = toSafeString(el.attr('data-type'));
      const type = normalizeServerType(rawType);
      const name = toSafeString(el.text()).toLowerCase().replace(/\s+/g, '-');
      const linkId = toSafeString(el.attr('data-link-id'));
      if (!name || !linkId) {
        return;
      }

      counters[type] += 1;
      const entry = {
        index: counters[type],
        type,
        id: null,
        name,
        _linkId: linkId,
        _watchUrl: watchUrl,
      };

      if (type === 'dub') {
        dubRaw.push(entry);
      } else {
        subRaw.push(entry);
      }
    });

  return {
    subRaw,
    dubRaw,
  };
}

function toExploreEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const id = toSafeString(entry.id);
  if (!id) {
    return null;
  }

  const episodes = entry.episodes || {};
  const sub = Math.max(0, toNumber(episodes.sub, 0));
  const dub = Math.max(0, toNumber(episodes.dub, 0));
  const eps = Math.max(Math.max(sub, dub), toNumber(episodes.eps, 0));

  return {
    title: toSafeString(entry.title),
    alternativeTitle: toSafeString(entry.alternativeTitle || entry.title),
    id,
    poster: toSafeString(entry.poster),
    episodes: {
      sub,
      dub,
      eps,
    },
    type: toSafeString(entry.type || 'TV'),
    duration: toSafeString(entry.duration || 'N/A'),
  };
}

function toSinglePageResponse(rows, page) {
  const pageNumber = Math.max(1, toNumber(page, 1));
  const list = (Array.isArray(rows) ? rows : [])
    .map((entry) => toExploreEntry(entry))
    .filter(Boolean);

  const unique = [];
  const seen = new Set();
  for (const item of list) {
    const key = item.id;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }

  return {
    pageInfo: {
      currentPage: pageNumber,
      totalPages: 1,
      hasNextPage: false,
    },
    response: pageNumber === 1 ? unique.slice(0, 20) : [],
  };
}

async function loadEpisodeRowsForAnime(animeId, c) {
  const context = await loadWatchContextBySlug(animeId, c);
  const payload = await fetchAjaxJson(`/ajax/episode/list/${context.dataId}`, c, {
    referer: context.watchUrl,
  });

  const rows = parseEpisodeRows(payload?.result, context.watchSlug);
  if (rows.length < 1) {
    throw new NotFoundError('episodes not found');
  }

  return {
    context,
    rows,
  };
}

export async function getHianimeWebHomeData(c) {
  const html = await fetchTextWithSession('/home', c, {
    referer: `${getWebOrigin(c)}/`,
  });
  const parsed = homeExtract(html);

  if (
    (!Array.isArray(parsed.topAiring) || parsed.topAiring.length < 1) &&
    Array.isArray(parsed.mostPopular)
  ) {
    parsed.topAiring = parsed.mostPopular.slice(0, 20);
  }

  if (
    (!Array.isArray(parsed.topUpcoming) || parsed.topUpcoming.length < 1) &&
    Array.isArray(parsed.newAdded)
  ) {
    parsed.topUpcoming = parsed.newAdded.slice(0, 20);
  }

  if (
    (!Array.isArray(parsed.latestCompleted) || parsed.latestCompleted.length < 1) &&
    Array.isArray(parsed.completed)
  ) {
    parsed.latestCompleted = parsed.completed.slice(0, 20);
  }

  if (
    (!Array.isArray(parsed.latestEpisode) || parsed.latestEpisode.length < 1) &&
    Array.isArray(parsed.recentlyUpdated)
  ) {
    parsed.latestEpisode = parsed.recentlyUpdated.slice(0, 20);
  }

  return parsed;
}

export async function getHianimeWebExploreData(query, page, c) {
  const normalized = toSafeString(query).toLowerCase();
  const home = await getHianimeWebHomeData(c);

  if (normalized === 'top-airing') {
    return toSinglePageResponse(
      Array.isArray(home.topAiring) && home.topAiring.length ? home.topAiring : home.mostPopular,
      page
    );
  }
  if (normalized === 'most-popular') {
    return toSinglePageResponse(home.mostPopular, page);
  }
  if (normalized === 'most-favorite') {
    return toSinglePageResponse(home.mostFavorite, page);
  }
  if (normalized === 'recently-added') {
    return toSinglePageResponse(home.newAdded, page);
  }
  if (normalized === 'recently-updated') {
    return toSinglePageResponse(home.latestEpisode, page);
  }
  if (normalized === 'top-upcoming') {
    return toSinglePageResponse(
      Array.isArray(home.topUpcoming) && home.topUpcoming.length ? home.topUpcoming : home.newAdded,
      page
    );
  }
  if (normalized === 'completed') {
    return toSinglePageResponse(home.latestCompleted, page);
  }

  const combined = [
    ...(home.topAiring || []),
    ...(home.mostPopular || []),
    ...(home.mostFavorite || []),
    ...(home.latestEpisode || []),
    ...(home.newAdded || []),
  ];

  if (normalized === 'subbed-anime') {
    return toSinglePageResponse(
      combined.filter((entry) => toNumber(entry?.episodes?.sub, 0) > 0),
      page
    );
  }
  if (normalized === 'dubbed-anime') {
    return toSinglePageResponse(
      combined.filter((entry) => toNumber(entry?.episodes?.dub, 0) > 0),
      page
    );
  }
  if (['movie', 'tv', 'ova', 'ona', 'special'].includes(normalized)) {
    return toSinglePageResponse(
      combined.filter((entry) => toSafeString(entry?.type).toLowerCase().includes(normalized)),
      page
    );
  }

  return getHianimeWebSearchData(normalized.replace(/-/g, ' '), page, c);
}

export async function getHianimeWebSearchData(keyword, page, c) {
  const pageNumber = Math.max(1, toNumber(page, 1));
  const query = encodeURIComponent(toSafeString(keyword));
  const html = await fetchTextWithSession(`/search?keyword=${query}&page=${pageNumber}`, c, {
    referer: `${getWebOrigin(c)}/home`,
  });
  const parsed = exploreExtract(html);
  if (Array.isArray(parsed?.response) && parsed.response.length > 0) {
    return parsed;
  }

  const suggestionRows = await getHianimeWebSuggestionData(keyword, c);
  return {
    pageInfo: {
      currentPage: 1,
      totalPages: 1,
      hasNextPage: false,
    },
    response: suggestionRows.map((entry) => ({
      title: entry.title,
      alternativeTitle: entry.alternativeTitle,
      id: entry.id,
      poster: entry.poster,
      episodes: {
        sub: 0,
        dub: 0,
        eps: 0,
      },
      type: entry.type || 'TV',
      duration: entry.duration || 'N/A',
    })),
  };
}

export async function getHianimeWebSuggestionData(keyword, c) {
  const payload = await fetchAjaxJson(
    `/ajax/anime/search?keyword=${encodeURIComponent(toSafeString(keyword))}`,
    c
  );
  const $ = load(`<div id="suggestion-root">${toSafeString(payload?.result?.html)}</div>`);
  const response = [];
  const seen = new Set();

  $('#suggestion-root')
    .find('a[href^="/watch/"]')
    .each((_, element) => {
      if (response.length >= 12) {
        return;
      }

      const el = $(element);
      const href = toSafeString(el.attr('href'));
      const id = toSafeString(href.split('/watch/').pop());
      if (!id || seen.has(id)) {
        return;
      }
      seen.add(id);

      const title =
        toSafeString(el.find('.film-name').text()) ||
        toSafeString(el.attr('title')) ||
        toSafeString(el.find('img').attr('alt'));

      response.push({
        title,
        alternativeTitle: title,
        id,
        poster: toSafeString(el.find('img').attr('data-src') || el.find('img').attr('src')),
        aired: '',
        type: 'TV',
        duration: 'N/A',
      });
    });

  return response;
}

export async function getHianimeWebAnimeInfoData(id, c) {
  const context = await loadWatchContextBySlug(id, c);
  const data = infoExtract(context.html);

  return {
    ...data,
    id: toSafeString(data?.id || context.watchSlug),
    title: toSafeString(data?.title),
    alternativeTitle: toSafeString(data?.alternativeTitle || data?.title),
  };
}

export async function getHianimeWebEpisodesData(animeId, c) {
  const { rows } = await loadEpisodeRowsForAnime(animeId, c);

  return rows.map((episode) => ({
    title: episode.title,
    alternativeTitle: episode.alternativeTitle,
    id: episode.id,
    isFiller: episode.isFiller,
    episodeNumber: episode.episodeNumber,
  }));
}

export async function getHianimeWebServersData(episodeId, c) {
  const { animeId, episodeRef } = parseLegacyEpisodeId(episodeId);
  const { context, rows } = await loadEpisodeRowsForAnime(animeId || episodeId, c);
  const targetEpisode = pickEpisodeRow(rows, episodeRef);
  if (!targetEpisode) {
    throw new NotFoundError('episode not found');
  }

  const payload = await fetchAjaxJson(
    `/ajax/server/list?servers=${encodeURIComponent(targetEpisode.dataIds)}`,
    c,
    {
      referer: context.watchUrl,
    }
  );

  const parsed = parseServerRows(payload?.result, context.watchUrl);
  if (parsed.subRaw.length < 1 && parsed.dubRaw.length < 1) {
    throw new NotFoundError('servers not found');
  }

  return {
    episode: targetEpisode.episodeNumber,
    sub: parsed.subRaw.map(({ index, type, id, name }) => ({ index, type, id, name })),
    dub: parsed.dubRaw.map(({ index, type, id, name }) => ({ index, type, id, name })),
    _subRaw: parsed.subRaw,
    _dubRaw: parsed.dubRaw,
  };
}

export async function getHianimeWebStreamData(id, serverName, type, c) {
  const normalizedType = toSafeString(type || 'sub').toLowerCase() === 'dub' ? 'dub' : 'sub';
  const normalizedServerName = toSafeString(serverName || '').toLowerCase();

  const servers = await getHianimeWebServersData(id, c);
  const sourceList = normalizedType === 'dub' ? servers._dubRaw : servers._subRaw;
  const selected =
    sourceList.find((entry) => entry.name === normalizedServerName) ||
    sourceList.find((entry) => entry.name.includes(normalizedServerName) && normalizedServerName) ||
    sourceList[0];

  if (!selected?._linkId) {
    throw new NotFoundError('stream source not found');
  }

  const payload = await fetchAjaxJson(
    `/ajax/server?get=${encodeURIComponent(selected._linkId)}`,
    c,
    {
      referer: selected._watchUrl,
    }
  );

  const streamUrl = toSafeString(payload?.result?.url);
  if (!streamUrl) {
    throw new validationError('invalid stream source url');
  }

  const skipData = payload?.result?.skip_data || {};
  const intro = Array.isArray(skipData?.intro) ? skipData.intro : [0, 0];
  const outro = Array.isArray(skipData?.outro) ? skipData.outro : [0, 0];
  const isDirect = isLikelyDirectMediaUrl(streamUrl);

  return [
    {
      id,
      type: normalizedType,
      link: {
        file: streamUrl,
        type: isDirect ? mediaTypeForUrl(streamUrl) : 'text/html',
      },
      tracks: [],
      intro: {
        start: toNumber(intro[0], 0),
        end: toNumber(intro[1], 0),
      },
      outro: {
        start: toNumber(outro[0], 0),
        end: toNumber(outro[1], 0),
      },
      server: selected.name,
      referer: toSafeString(selected._watchUrl) || `${getWebOrigin(c)}/`,
      isDirect,
    },
  ];
}

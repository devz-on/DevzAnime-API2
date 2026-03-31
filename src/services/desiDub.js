import { getCachedCatalog, loadCatalog, warmCatalog } from './catalog.js';
import { toExploreAnime } from './normalizers.js';
import { toNumber, toSafeString } from './normalizers.js';
import { fetchJsonWithMeta, getProviderConfig } from './upstream.js';
import { buildDesiFallbackId, decodeHtmlEntities, getCatalogMatcherIndex, resolveDesiDubMapping } from './desiDubMapper.js';
import { validationError } from '../utils/errors.js';

const PAGE_SIZE = 20;
const FALLBACK_HINDI_TAG_ID = 74;
const WP_ANIME_FIELDS =
  'id,slug,link,title,class_list,jetpack_featured_media_url,yoast_head_json.og_image,yoast_head_json.twitter_image,_embedded.wp:featuredmedia.source_url,_embedded.wp:featuredmedia.guid.rendered,_embedded.wp:featuredmedia.media_details.sizes.medium.source_url,_embedded.wp:term.taxonomy,_embedded.wp:term.name';
const UNKNOWN_EPISODES = {
  sub: 0,
  dub: 1,
  eps: 0,
};

const cache = {
  tagId: null,
  tagAt: 0,
  pages: new Map(),
  searches: new Map(),
};

function now() {
  return Date.now();
}

function toHeaderValue(headers, key) {
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    return toSafeString(headers.get(key) || headers.get(String(key).toLowerCase()));
  }
  if (typeof headers === 'object') {
    return toSafeString(headers[key] || headers[String(key).toLowerCase()]);
  }
  return '';
}

export function parseWpPagination(headers, fallbackPage = 1) {
  const totalPages = Math.max(1, toNumber(toHeaderValue(headers, 'x-wp-totalpages'), fallbackPage));
  const totalItems = Math.max(0, toNumber(toHeaderValue(headers, 'x-wp-total'), 0));
  const currentPage = Math.max(1, toNumber(fallbackPage, 1));
  return {
    currentPage,
    totalPages,
    hasNextPage: currentPage < totalPages,
    totalItems,
  };
}

function flattenTermCollections(row) {
  const embeddedTerms = row?._embedded?.['wp:term'];
  if (!Array.isArray(embeddedTerms)) return [];
  return embeddedTerms.flatMap((group) => (Array.isArray(group) ? group : []));
}

function findTermName(row, taxonomy) {
  const terms = flattenTermCollections(row);
  const match = terms.find((term) => toSafeString(term?.taxonomy) === taxonomy);
  return decodeHtmlEntities(match?.name);
}

function extractPoster(row) {
  const media = row?._embedded?.['wp:featuredmedia'];
  const first = Array.isArray(media) ? media[0] : null;
  const fromYoast = Array.isArray(row?.yoast_head_json?.og_image)
    ? row.yoast_head_json.og_image[0]?.url
    : '';
  return toSafeString(
    first?.source_url ||
      first?.guid?.rendered ||
      first?.media_details?.sizes?.medium?.source_url ||
      row?.jetpack_featured_media_url ||
      fromYoast ||
      row?.yoast_head_json?.twitter_image
  );
}

function getDefaultType(row) {
  const typeFromTerms = findTermName(row, 'anime_type');
  if (typeFromTerms) return typeFromTerms.toUpperCase();

  const classes = Array.isArray(row?.class_list) ? row.class_list : [];
  const classType = classes.find((name) => toSafeString(name).startsWith('type-'));
  if (classType) {
    return toSafeString(classType.replace(/^type-/, '')).toUpperCase();
  }

  return 'TV';
}

export function normalizeDesiAnimeRow(row) {
  const postId = toNumber(row?.id, 0);
  const slug = toSafeString(row?.slug);
  const rawTitle = row?.title && typeof row.title === 'object' ? row.title?.rendered : row?.title;
  const title = decodeHtmlEntities(rawTitle || '');
  const url = toSafeString(row?.link);

  return {
    postId,
    slug,
    title,
    url,
    poster: extractPoster(row),
    type: getDefaultType(row),
    duration: 'N/A',
  };
}

function getPageCacheKey(tagId, page) {
  return `${tagId}:${page}`;
}

function getSearchCacheKey(tagId, page, keyword) {
  return `${tagId}:${page}:${toSafeString(keyword).toLowerCase()}`;
}

async function resolveHindiTagId(c) {
  const config = getProviderConfig(c);
  if (config.desiDubTagId > 0) {
    return config.desiDubTagId;
  }

  const cacheValid =
    cache.tagId &&
    now() - cache.tagAt < config.desiDubCacheTtlSeconds * 1000;
  if (cacheValid) {
    return cache.tagId;
  }

  const query = new URLSearchParams({
    slug: config.desiDubTagSlug || 'hindi',
    per_page: '1',
  });
  const endpoint = `${config.desiDubWpApiBaseUrl}/tags?${query.toString()}`;
  const { payload } = await fetchJsonWithMeta(endpoint, c, config.desiDubSiteBaseUrl);
  const first = Array.isArray(payload) ? payload[0] : null;
  const parsedTagId = toNumber(first?.id, 0);
  const resolvedTagId = parsedTagId > 0 ? parsedTagId : FALLBACK_HINDI_TAG_ID;

  cache.tagId = resolvedTagId;
  cache.tagAt = now();
  return resolvedTagId;
}

async function fetchHindiDubPage(page, c) {
  const config = getProviderConfig(c);
  const safePage = Math.max(1, toNumber(page, 1));
  const tagId = await resolveHindiTagId(c);
  const cacheKey = getPageCacheKey(tagId, safePage);
  const cached = cache.pages.get(cacheKey);
  const cacheValid = cached && now() - cached.at < config.desiDubCacheTtlSeconds * 1000;
  if (cacheValid) {
    return cached.value;
  }

  const query = new URLSearchParams({
    tags: String(tagId),
    page: String(safePage),
    per_page: String(PAGE_SIZE),
    _embed: '1',
    _fields: WP_ANIME_FIELDS,
  });

  const endpoint = `${config.desiDubWpApiBaseUrl}/anime?${query.toString()}`;
  const { payload, headers } = await fetchJsonWithMeta(endpoint, c, config.desiDubSiteBaseUrl);
  if (!Array.isArray(payload)) {
    throw new validationError('desidub anime payload is invalid');
  }

  const pagination = parseWpPagination(headers, safePage);
  const value = {
    rows: payload,
    pageInfo: {
      currentPage: pagination.currentPage,
      totalPages: pagination.totalPages,
      hasNextPage: pagination.hasNextPage,
    },
  };

  cache.pages.set(cacheKey, {
    at: now(),
    value,
  });
  return value;
}

async function fetchHindiDubSearchPage(keyword, page, c) {
  const safeKeyword = toSafeString(keyword);
  if (!safeKeyword) {
    throw new validationError('search keyword is required');
  }

  const config = getProviderConfig(c);
  const safePage = Math.max(1, toNumber(page, 1));
  const tagId = await resolveHindiTagId(c);
  const cacheKey = getSearchCacheKey(tagId, safePage, safeKeyword);
  const cached = cache.searches.get(cacheKey);
  const cacheValid = cached && now() - cached.at < config.desiDubCacheTtlSeconds * 1000;
  if (cacheValid) {
    return cached.value;
  }

  const query = new URLSearchParams({
    tags: String(tagId),
    page: String(safePage),
    per_page: String(PAGE_SIZE),
    _embed: '1',
    search: safeKeyword,
    _fields: WP_ANIME_FIELDS,
  });
  const endpoint = `${config.desiDubWpApiBaseUrl}/anime?${query.toString()}`;
  const { payload, headers } = await fetchJsonWithMeta(endpoint, c, config.desiDubSiteBaseUrl);
  if (!Array.isArray(payload)) {
    throw new validationError('desidub search payload is invalid');
  }

  const pagination = parseWpPagination(headers, safePage);
  const value = {
    rows: payload,
    pageInfo: {
      currentPage: pagination.currentPage,
      totalPages: pagination.totalPages,
      hasNextPage: pagination.hasNextPage,
    },
  };

  cache.searches.set(cacheKey, {
    at: now(),
    value,
  });
  return value;
}

function toMappingDetails(source, mapping) {
  return {
    mapped: Boolean(mapping?.mapped),
    daniId: mapping?.daniId || null,
    method: mapping?.method || 'none',
    confidence: toNumber(mapping?.confidence, 0),
    source: {
      postId: toNumber(source?.postId, 0),
      slug: toSafeString(source?.slug),
      url: toSafeString(source?.url),
    },
  };
}

function toMappedExploreItem(source, mapping) {
  const mappedAnime = toExploreAnime(mapping.entry);
  const streamId = buildDesiFallbackId(source);
  return {
    ...mappedAnime,
    poster: source.poster || mappedAnime.poster,
    streamId,
    mapping: toMappingDetails(source, mapping),
  };
}

function toUnmappedExploreItem(source, mapping) {
  const fallbackId = buildDesiFallbackId(source);
  const safeTitle = source.title || source.slug || 'Unknown';
  return {
    title: safeTitle,
    alternativeTitle: safeTitle,
    id: fallbackId,
    streamId: fallbackId,
    poster: source.poster,
    episodes: { ...UNKNOWN_EPISODES },
    type: source.type || 'TV',
    duration: source.duration || 'N/A',
    mapping: toMappingDetails(source, mapping),
  };
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = toSafeString(value).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

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

function scheduleCatalogWarmup(c) {
  const warmupPromise = warmCatalog(c);
  let waitUntil = null;
  let executionCtx = null;
  try {
    executionCtx = c?.executionCtx;
    waitUntil = executionCtx?.waitUntil;
  } catch {
    waitUntil = null;
    executionCtx = null;
  }
  if (typeof waitUntil === 'function') {
    try {
      waitUntil.call(executionCtx, warmupPromise);
      return;
    } catch {
      // Some runtimes/test contexts expose waitUntil but do not provide ExecutionContext.
    }
  }
  warmupPromise.catch(() => {
    // Best-effort warmup only.
  });
}

function toUnmappedRows(rows, mappedOnlyFlag) {
  if (mappedOnlyFlag) {
    return [];
  }

  return rows
    .map((row) => normalizeDesiAnimeRow(row))
    .map((source) =>
      toUnmappedExploreItem(source, {
        mapped: false,
        daniId: null,
        method: 'none',
        confidence: 0,
      })
    );
}

function mapRowsToExplore(rows, mappedOnlyFlag, catalog, matcherIndex) {
  const mappedRows = rows
    .map((row) => normalizeDesiAnimeRow(row))
    .map((source) => {
      const mapping = resolveDesiDubMapping(source, catalog, matcherIndex);
      if (mapping?.mapped && mapping?.entry) {
        return toMappedExploreItem(source, mapping);
      }
      return toUnmappedExploreItem(source, mapping);
    });

  return mappedOnlyFlag
    ? mappedRows.filter((row) => row?.mapping?.mapped)
    : mappedRows;
}

export async function getHindiDubbedData(page, mappedOnly, c, options = {}) {
  const safePage = Math.max(1, toNumber(page, 1));
  const mappedOnlyFlag = toBoolean(mappedOnly);
  const allowWarmup = options?.allowWarmup !== false;
  const workerRuntime = isLikelyWorkerRuntime(c);
  const workerCtxAvailable = hasExecutionContext(c);

  const sourcePage = await fetchHindiDubPage(safePage, c);
  let catalog = getCachedCatalog(c);

  if (!catalog) {
    if (workerRuntime && !mappedOnlyFlag) {
      if (allowWarmup && workerCtxAvailable) {
        scheduleCatalogWarmup(c);
      }
      return {
        pageInfo: sourcePage.pageInfo,
        response: toUnmappedRows(sourcePage.rows, mappedOnlyFlag),
      };
    }

    if (allowWarmup && workerCtxAvailable && !mappedOnlyFlag) {
      scheduleCatalogWarmup(c);
    } else {
      catalog = await loadCatalog(c);
    }
  }

  if (!catalog) {
    return {
      pageInfo: sourcePage.pageInfo,
      response: toUnmappedRows(sourcePage.rows, mappedOnlyFlag),
    };
  }

  const matcherIndex = getCatalogMatcherIndex(catalog);
  const filteredRows = mapRowsToExplore(sourcePage.rows, mappedOnlyFlag, catalog, matcherIndex);

  return {
    pageInfo: sourcePage.pageInfo,
    response: filteredRows,
  };
}

export async function getHindiDubbedSearchData(keyword, page, mappedOnly, c, options = {}) {
  const safePage = Math.max(1, toNumber(page, 1));
  const mappedOnlyFlag = toBoolean(mappedOnly);
  const allowWarmup = options?.allowWarmup !== false;
  const workerRuntime = isLikelyWorkerRuntime(c);
  const workerCtxAvailable = hasExecutionContext(c);
  const safeKeyword = toSafeString(keyword).replaceAll('+', ' ');
  if (!safeKeyword) {
    throw new validationError('search keyword is required');
  }

  const searchPage = await fetchHindiDubSearchPage(safeKeyword, safePage, c);
  let catalog = getCachedCatalog(c);

  if (!catalog) {
    if (workerRuntime && !mappedOnlyFlag) {
      return {
        pageInfo: searchPage.pageInfo,
        response: toUnmappedRows(searchPage.rows, mappedOnlyFlag),
      };
    }

    if (allowWarmup && workerCtxAvailable && !mappedOnlyFlag) {
      scheduleCatalogWarmup(c);
    } else {
      catalog = await loadCatalog(c);
    }
  }

  if (!catalog) {
    return {
      pageInfo: searchPage.pageInfo,
      response: toUnmappedRows(searchPage.rows, mappedOnlyFlag),
    };
  }

  const matcherIndex = getCatalogMatcherIndex(catalog);
  const filteredRows = mapRowsToExplore(searchPage.rows, mappedOnlyFlag, catalog, matcherIndex);

  return {
    pageInfo: searchPage.pageInfo,
    response: filteredRows,
  };
}

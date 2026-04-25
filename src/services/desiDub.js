import { toNumber, toSafeString } from './normalizers.js';
import { fetchJsonWithMeta, getProviderConfig } from './upstream.js';
import { buildDesiFallbackId, decodeHtmlEntities } from './desiDubMapper.js';
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

  const cacheValid = cache.tagId && now() - cache.tagAt < config.desiDubCacheTtlSeconds * 1000;
  if (cacheValid) {
    return cache.tagId;
  }

  const query = new URLSearchParams({
    slug: config.desiDubTagSlug || 'hindi',
    per_page: '1',
  });
  const endpoint = `${config.desiDubWpApiBaseUrl}/tags?${query.toString()}`;
  const { payload } = await fetchJsonWithMeta(endpoint, c, config.desiDubSiteBaseUrl, {
    useProxy: false,
  });
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
  const { payload, headers } = await fetchJsonWithMeta(endpoint, c, config.desiDubSiteBaseUrl, {
    useProxy: false,
  });
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
  const { payload, headers } = await fetchJsonWithMeta(endpoint, c, config.desiDubSiteBaseUrl, {
    useProxy: false,
  });
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

function toHindiExploreItem(source) {
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
  };
}

function toResponseRows(rows) {
  return rows.map((row) => normalizeDesiAnimeRow(row)).map((source) => toHindiExploreItem(source));
}

export async function getHindiDubbedData(page, c, options = {}) {
  const safePage = Math.max(1, toNumber(page, 1));
  void options;

  const sourcePage = await fetchHindiDubPage(safePage, c);
  return {
    pageInfo: sourcePage.pageInfo,
    response: toResponseRows(sourcePage.rows),
  };
}

export async function getHindiDubbedSearchData(keyword, page, c, options = {}) {
  const safePage = Math.max(1, toNumber(page, 1));
  void options;
  const safeKeyword = toSafeString(keyword).replaceAll('+', ' ');
  if (!safeKeyword) {
    throw new validationError('search keyword is required');
  }

  const searchPage = await fetchHindiDubSearchPage(safeKeyword, safePage, c);
  return {
    pageInfo: searchPage.pageInfo,
    response: toResponseRows(searchPage.rows),
  };
}

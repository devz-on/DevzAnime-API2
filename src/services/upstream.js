import { validationError } from '../utils/errors.js';

const FETCH_TIMEOUT_MS = 12_000;

function toSafeString(value) {
  return String(value ?? '').trim();
}

function toNumber(value, fallback = 0) {
  const numeric = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeBaseUrl(value) {
  return toSafeString(value).replace(/\/+$/, '');
}

function normalizeReferer(value) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) {
    return '';
  }
  return `${normalized}/`;
}

function parseCsvList(value) {
  return toSafeString(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mergeUnique(values) {
  const seen = new Set();
  const output = [];
  values.forEach((value) => {
    const normalized = toSafeString(value);
    if (!normalized) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    output.push(normalized);
  });
  return output;
}

export function getRuntimeEnv(c) {
  const processEnv = typeof process !== 'undefined' && process?.env ? process.env : {};
  const contextEnv = c?.env && typeof c.env === 'object' ? c.env : {};
  const workerEnv =
    typeof globalThis !== 'undefined' &&
    globalThis.__APP_RUNTIME_ENV__ &&
    typeof globalThis.__APP_RUNTIME_ENV__ === 'object'
      ? globalThis.__APP_RUNTIME_ENV__
      : {};

  return {
    ...processEnv,
    ...workerEnv,
    ...contextEnv,
  };
}

export function getProviderConfig(c) {
  const env = getRuntimeEnv(c);
  const desiDubSiteBaseUrl = toSafeString(env.DESIDUB_SITE_BASE_URL || 'https://www.desidubanime.me').replace(
    /\/+$/,
    ''
  );
  const desiDubWpApiBaseUrl = toSafeString(
    env.DESIDUB_WP_API_BASE_URL || `${desiDubSiteBaseUrl}/wp-json/wp/v2`
  ).replace(/\/+$/, '');
  const defaultApiBaseUrls = ['https://hianime.dk/api', 'https://hianime.bar/api', 'https://9animes.cv/api'];
  const defaultReferers = ['https://hianime.dk/', 'https://hianime.bar/', 'https://hianimes.se/'];

  const configuredApiBaseUrl = normalizeBaseUrl(env.HIANIMES_API_BASE_URL || '');
  const configuredApiBaseUrls = parseCsvList(env.HIANIMES_API_BASE_URLS).map((entry) => normalizeBaseUrl(entry));
  const hianimesApiBaseUrls = mergeUnique([
    ...configuredApiBaseUrls,
    configuredApiBaseUrl,
    ...defaultApiBaseUrls,
  ]).filter(Boolean);

  const configuredReferer = normalizeReferer(env.HIANIMES_REFERER || '');
  const configuredReferers = parseCsvList(env.HIANIMES_REFERERS).map((entry) => normalizeReferer(entry));
  const hianimesReferers = mergeUnique([...configuredReferers, configuredReferer, ...defaultReferers]).filter(
    Boolean
  );

  return {
    hianimesApiBaseUrl: hianimesApiBaseUrls[0] || defaultApiBaseUrls[0],
    hianimesApiBaseUrls,
    hianimesAjaxBaseUrl: toSafeString(env.HIANIMES_AJAX_BASE_URL || 'https://nine.mewcdn.online').replace(
      /\/+$/,
      ''
    ),
    hianimesReferer: hianimesReferers[0] || defaultReferers[0],
    hianimesReferers,
    m3u8ProxyUrl: toSafeString(env.UPSTREAM_PROXY_M3U8_URL || ''),
    daniProxyUrl: toSafeString(
      env.UPSTREAM_PROXY_DANI_URL || 'https://daniapi.bhoothihu.workers.dev/api/v1/proxy'
    ),
    jikanApiBaseUrl: toSafeString(env.JIKAN_API_BASE_URL || 'https://api.jikan.moe/v4').replace(
      /\/+$/,
      ''
    ),
    catalogCacheTtlSeconds: Math.max(60, toNumber(env.CATALOG_CACHE_TTL_SECONDS, 900)),
    detailCacheTtlSeconds: Math.max(60, toNumber(env.DETAIL_CACHE_TTL_SECONDS, 300)),
    maxCatalogPages: Math.max(1, toNumber(env.CATALOG_MAX_PAGES, 6)),
    desiDubSiteBaseUrl,
    desiDubWpApiBaseUrl,
    desiDubTagSlug: toSafeString(env.DESIDUB_TAG_SLUG || 'hindi') || 'hindi',
    desiDubTagId: Math.max(0, toNumber(env.DESIDUB_TAG_ID, 0)),
    desiDubCacheTtlSeconds: Math.max(60, toNumber(env.DESIDUB_CACHE_TTL_SECONDS, 300)),
  };
}

function buildUrlWithParams(base, params) {
  const url = new URL(base);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

export function buildProxyUrl(proxyBaseUrl, targetUrl, referer) {
  if (!proxyBaseUrl) {
    return '';
  }
  const url = new URL(proxyBaseUrl);
  url.searchParams.set('url', targetUrl);
  if (referer) {
    url.searchParams.set('referer', referer);
  }
  return url.toString();
}

function withCacheBust(url, cacheBustToken) {
  if (!url) {
    return '';
  }
  const token = toSafeString(cacheBustToken);
  if (!token) {
    return url;
  }
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('_cb', token);
    return parsed.toString();
  } catch {
    return url;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readText(response) {
  return response.text();
}

async function fetchJsonWithResponse(targetUrl, c, overrideReferer) {
  const config = getProviderConfig(c);
  const referer = overrideReferer || config.hianimesReferer;
  const cacheBustToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const candidates = [
    targetUrl,
    withCacheBust(buildProxyUrl(config.m3u8ProxyUrl, targetUrl, referer), cacheBustToken),
    withCacheBust(buildProxyUrl(config.daniProxyUrl, targetUrl, referer), cacheBustToken),
  ].filter(Boolean);

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const response = await fetchWithTimeout(candidate, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          Referer: referer,
          Origin: (() => {
            try {
              return new URL(referer).origin;
            } catch {
              return undefined;
            }
          })(),
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        const payload = await readJson(response);
        const message = payload?.message || `upstream failed (${response.status})`;
        throw new validationError(message, { statusCode: response.status, upstream: candidate });
      }

      const payload = await readJson(response);
      if (payload === null) {
        throw new validationError('upstream returned invalid json', { upstream: candidate });
      }

      return {
        payload,
        response,
        upstreamUrl: candidate,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new validationError('failed to fetch upstream data');
}

async function fetchTextWithResponse(targetUrl, c, overrideReferer) {
  const config = getProviderConfig(c);
  const referer = overrideReferer || config.hianimesReferer;
  const cacheBustToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const candidates = [
    targetUrl,
    withCacheBust(buildProxyUrl(config.m3u8ProxyUrl, targetUrl, referer), cacheBustToken),
    withCacheBust(buildProxyUrl(config.daniProxyUrl, targetUrl, referer), cacheBustToken),
  ].filter(Boolean);

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const response = await fetchWithTimeout(candidate, {
        headers: {
          Accept: 'text/html,application/json,text/plain,*/*',
          Referer: referer,
          Origin: (() => {
            try {
              return new URL(referer).origin;
            } catch {
              return undefined;
            }
          })(),
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        const payload = await readJson(response);
        const message = payload?.message || `upstream failed (${response.status})`;
        throw new validationError(message, { statusCode: response.status, upstream: candidate });
      }

      const text = await readText(response);
      if (!toSafeString(text)) {
        throw new validationError('upstream returned empty text', { upstream: candidate });
      }

      return {
        text,
        response,
        upstreamUrl: candidate,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new validationError('failed to fetch upstream text');
}

export async function fetchJsonWithFallback(targetUrl, c, overrideReferer) {
  const result = await fetchJsonWithResponse(targetUrl, c, overrideReferer);
  return result.payload;
}

export async function fetchJsonWithMeta(targetUrl, c, overrideReferer) {
  const { payload, response, upstreamUrl } = await fetchJsonWithResponse(targetUrl, c, overrideReferer);
  return {
    payload,
    headers: response.headers,
    statusCode: response.status,
    upstreamUrl,
  };
}

export async function fetchTextWithFallback(targetUrl, c, overrideReferer) {
  const result = await fetchTextWithResponse(targetUrl, c, overrideReferer);
  return result.text;
}

export async function fetchTextWithMeta(targetUrl, c, overrideReferer) {
  const { text, response, upstreamUrl } = await fetchTextWithResponse(targetUrl, c, overrideReferer);
  return {
    text,
    headers: response.headers,
    statusCode: response.status,
    upstreamUrl,
  };
}

export async function fetchApi(path, c, params = {}) {
  const config = getProviderConfig(c);
  const cleanedPath = path.startsWith('/') ? path : `/${path}`;
  const baseUrls = Array.isArray(config.hianimesApiBaseUrls) && config.hianimesApiBaseUrls.length > 0
    ? config.hianimesApiBaseUrls
    : [config.hianimesApiBaseUrl];
  const referers = Array.isArray(config.hianimesReferers) && config.hianimesReferers.length > 0
    ? config.hianimesReferers
    : [config.hianimesReferer];

  const isHianimeDkBase = (baseUrl) => {
    try {
      return new URL(baseUrl).hostname.toLowerCase().includes('hianime.dk');
    } catch {
      return false;
    }
  };

  const mapPathForBase = (inputPath, baseUrl) => {
    if (!isHianimeDkBase(baseUrl)) {
      return inputPath;
    }

    if (inputPath === '/anime/trending') return '/trending';
    if (inputPath === '/anime/popular') return '/most-popular';
    if (inputPath === '/latest/anime') return '/recently-added';
    if (inputPath === '/latest/episode') return '/recently-updated';
    if (inputPath === '/anime') return '/most-popular';

    if (inputPath.startsWith('/anime/')) {
      const suffix = toSafeString(inputPath.slice('/anime/'.length));
      return suffix ? `/watch/${suffix}` : '/watch';
    }

    return inputPath;
  };

  const mapParamsForBase = (inputParams, mappedPath, baseUrl) => {
    const isDk = isHianimeDkBase(baseUrl);
    if (!isDk) {
      return inputParams;
    }

    const safeParams = { ...(inputParams || {}) };
    delete safeParams.cursor;
    delete safeParams.slugNth;
    delete safeParams.includeSlugs;
    delete safeParams.start;
    delete safeParams.end;

    if (
      mappedPath === '/trending' ||
      mappedPath === '/most-popular' ||
      mappedPath === '/top-airing' ||
      mappedPath === '/recently-added' ||
      mappedPath === '/recently-updated' ||
      mappedPath === '/most-favorite'
    ) {
      const page = toNumber(safeParams.page, 1);
      safeParams.page = Math.max(1, page);
      const limit = toNumber(safeParams.limit, 0);
      if (limit > 0) {
        safeParams.limit = limit;
      }
    }

    return safeParams;
  };

  let lastError = null;
  for (let index = 0; index < baseUrls.length; index += 1) {
    const baseUrl = normalizeBaseUrl(baseUrls[index]);
    if (!baseUrl) {
      continue;
    }
    const referer = toSafeString(referers[index] || referers[0] || config.hianimesReferer);
    const mappedPath = mapPathForBase(cleanedPath, baseUrl);
    const mappedParams = mapParamsForBase(params, mappedPath, baseUrl);
    const targetUrl = buildUrlWithParams(`${baseUrl}${mappedPath}`, mappedParams);

    try {
      return await fetchJsonWithFallback(targetUrl, c, referer || config.hianimesReferer);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new validationError('failed to fetch upstream api');
}

export async function fetchJikan(path, c, params = {}) {
  const config = getProviderConfig(c);
  const cleanedPath = path.startsWith('/') ? path : `/${path}`;
  const targetUrl = buildUrlWithParams(`${config.jikanApiBaseUrl}${cleanedPath}`, params);
  return fetchJsonWithFallback(targetUrl, c, 'https://myanimelist.net/');
}

export async function probeUrl(url) {
  try {
    const response = await fetchWithTimeout(url, { method: 'HEAD' }, 5_000);
    return response.ok || response.status === 405;
  } catch {
    return false;
  }
}

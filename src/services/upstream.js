import { validationError } from '../utils/errors.js';

const FETCH_TIMEOUT_MS = 12_000;

function toSafeString(value) {
  return String(value ?? '').trim();
}

function toNumber(value, fallback = 0) {
  const numeric = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : fallback;
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
  return {
    hianimesApiBaseUrl: toSafeString(env.HIANIMES_API_BASE_URL || 'https://9animes.cv/api').replace(
      /\/+$/,
      ''
    ),
    hianimesAjaxBaseUrl: toSafeString(env.HIANIMES_AJAX_BASE_URL || 'https://nine.mewcdn.online').replace(
      /\/+$/,
      ''
    ),
    hianimesReferer: toSafeString(env.HIANIMES_REFERER || 'https://hianimes.se/'),
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

async function fetchJsonFromUrl(url, referer) {
  const response = await fetchWithTimeout(url, {
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
    throw new validationError(message, { statusCode: response.status, upstream: url });
  }

  const payload = await readJson(response);
  if (payload === null) {
    throw new validationError('upstream returned invalid json', { upstream: url });
  }

  return payload;
}

export async function fetchJsonWithFallback(targetUrl, c, overrideReferer) {
  const config = getProviderConfig(c);
  const referer = overrideReferer || config.hianimesReferer;
  const candidates = [
    targetUrl,
    buildProxyUrl(config.m3u8ProxyUrl, targetUrl, referer),
    buildProxyUrl(config.daniProxyUrl, targetUrl, referer),
  ].filter(Boolean);

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return await fetchJsonFromUrl(candidate, referer);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new validationError('failed to fetch upstream data');
}

export async function fetchApi(path, c, params = {}) {
  const config = getProviderConfig(c);
  const cleanedPath = path.startsWith('/') ? path : `/${path}`;
  const targetUrl = buildUrlWithParams(`${config.hianimesApiBaseUrl}${cleanedPath}`, params);
  return fetchJsonWithFallback(targetUrl, c, config.hianimesReferer);
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

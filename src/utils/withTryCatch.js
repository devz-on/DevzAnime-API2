import { fail, success } from './response.js';
import { collectError } from '../workers/errorCollector.worker.js';

const CACHE_EXCLUDED_PATH_PATTERNS = [
  /^\/(?:api\/v1|v1)\/proxy(?:\/|$)/i,
  /^\/(?:api\/v1|v1)\/stream(?:\/|$)/i,
  /^\/(?:api\/v1|v1)\/servers(?:\/|$)/i,
  /^\/(?:api\/v1|v1)\/errors(?:\/|$)/i,
];

function getRuntimeEnv(c) {
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

function getEnvNumber(value, fallback, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, parsed);
}

function getEdgeCache() {
  const cacheStorage =
    typeof globalThis !== 'undefined' && globalThis?.caches ? globalThis.caches : null;
  if (!cacheStorage?.default) {
    return null;
  }
  return cacheStorage.default;
}

function isCacheablePath(pathname) {
  return !CACHE_EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
}

function resolveCacheTtlSeconds(pathname, env) {
  const explicitDefault = getEnvNumber(env?.RESPONSE_CACHE_DEFAULT_TTL_SECONDS, 240, 0);
  const staticTtl = getEnvNumber(env?.RESPONSE_CACHE_STATIC_TTL_SECONDS, 420, 0);
  const searchTtl = getEnvNumber(env?.RESPONSE_CACHE_SEARCH_TTL_SECONDS, 180, 0);
  const homeTtl = getEnvNumber(env?.RESPONSE_CACHE_HOME_TTL_SECONDS, 120, 0);

  const normalizedPath = String(pathname || '').toLowerCase();

  if (/\/(?:home|spotlight|topten)$/.test(normalizedPath)) {
    return homeTtl;
  }

  if (
    normalizedPath.includes('/search') ||
    normalizedPath.includes('/genre') ||
    normalizedPath.includes('/filter') ||
    normalizedPath.includes('/az-list') ||
    normalizedPath.includes('/producer')
  ) {
    return searchTtl;
  }

  if (
    normalizedPath.includes('/anime/') ||
    normalizedPath.includes('/episodes/') ||
    normalizedPath.includes('/characters') ||
    normalizedPath.includes('/character')
  ) {
    return staticTtl;
  }

  return explicitDefault;
}

function buildCacheControl(ttlSeconds) {
  const safeTtl = Math.max(0, Number(ttlSeconds) || 0);
  const swr = Math.max(30, Math.floor(safeTtl / 2));
  return `public, max-age=${safeTtl}, s-maxage=${safeTtl}, stale-while-revalidate=${swr}`;
}

function toCacheKeyRequest(c) {
  return new Request(c.req.url, { method: 'GET' });
}

export default function withTryCatch(fn) {
  return async (c, next) => {
    try {
      const env = getRuntimeEnv(c);
      const cacheEnabled = getEnvNumber(env?.RESPONSE_CACHE_ENABLED, 1, 0) > 0;
      const cache = cacheEnabled ? getEdgeCache() : null;
      const cacheableMethod = c.req.method === 'GET';
      const cacheablePath = isCacheablePath(c.req.path);
      const cacheTtlSeconds = resolveCacheTtlSeconds(c.req.path, env);
      const shouldUseEdgeCache =
        Boolean(cache) && cacheableMethod && cacheablePath && cacheTtlSeconds > 0;
      const cacheKey = shouldUseEdgeCache ? toCacheKeyRequest(c) : null;

      if (cacheKey) {
        try {
          const cachedResponse = await cache.match(cacheKey);
          if (cachedResponse) {
            const cachedHeaders = new Headers(cachedResponse.headers);
            cachedHeaders.set('x-edge-cache', 'HIT');
            return new Response(cachedResponse.body, {
              status: cachedResponse.status,
              headers: cachedHeaders,
            });
          }
        } catch (cacheReadError) {
          console.error('edge-cache read failed:', cacheReadError?.message || cacheReadError);
        }
      }

      const result = await fn(c, next);
      const response = success(c, result, null);

      if (!cacheKey) {
        return response;
      }

      const cacheHeaders = new Headers(response.headers);
      cacheHeaders.set('Cache-Control', buildCacheControl(cacheTtlSeconds));
      cacheHeaders.set('x-edge-cache', 'MISS');
      const cacheableResponse = new Response(response.body, {
        status: response.status,
        headers: cacheHeaders,
      });

      try {
        const writePromise = cache.put(cacheKey, cacheableResponse.clone());
        const waitUntil = c.executionCtx?.waitUntil;
        if (typeof waitUntil === 'function') {
          waitUntil.call(c.executionCtx, writePromise);
        } else {
          await writePromise;
        }
      } catch (cacheWriteError) {
        console.error('edge-cache write failed:', cacheWriteError?.message || cacheWriteError);
      }

      return cacheableResponse;
    } catch (error) {
      const statusCode = error?.statusCode || 500;
      const errorReport = collectError({
        source: 'route-handler',
        reason: statusCode >= 500 ? 'handler-error' : 'request-error',
        message: error?.message || 'route handler failed',
        method: c.req.method,
        path: c.req.path,
        statusCode,
        details: error?.details || null,
        stack: error?.stack || null,
      });

      console.error(error?.message || 'route handler failed');

      const normalizedDetails =
        error?.details && typeof error.details === 'object'
          ? { ...error.details, errorId: errorReport?.id || null }
          : errorReport?.id
            ? { errorId: errorReport.id }
            : error?.details || null;

      if (error?.statusCode) {
        return fail(c, error.message, error.statusCode, normalizedDetails);
      }
      return fail(c, error?.message || 'internal server error', 500, normalizedDetails);
    }
  };
}

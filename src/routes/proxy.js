function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function toAbsoluteUrl(input, baseUrl) {
  try {
    return new URL(input, baseUrl).toString();
  } catch {
    return input;
  }
}

function rewriteManifest(manifest, sourceUrl) {
  const uriAttrRegex = /URI=(["'])([^"']+)\1/g;

  return manifest
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      const lineWithRewrittenUri = line.replace(uriAttrRegex, (full, quote, uri) => {
        const absolute = toAbsoluteUrl(uri, sourceUrl);
        return `URI=${quote}${absolute}${quote}`;
      });

      if (trimmed.startsWith('#')) {
        return lineWithRewrittenUri;
      }

      return toAbsoluteUrl(trimmed, sourceUrl);
    })
    .join('\n');
}

function isManifestContentType(contentType) {
  const value = (contentType || '').toLowerCase();
  return (
    value.includes('application/vnd.apple.mpegurl') ||
    value.includes('application/x-mpegurl') ||
    value.includes('audio/mpegurl')
  );
}

function getPathname(targetUrl) {
  try {
    return new URL(targetUrl).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function isVttUrl(url) {
  return getPathname(url).endsWith('.vtt');
}

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

function getEnvNumber(env, key, fallback, min = 0) {
  const parsed = Number(env?.[key]);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, parsed);
}

function getProxyRuntimeConfig(c) {
  const env = getRuntimeEnv(c);
  const cacheModeRaw = String(env.PROXY_CACHE_MODE || 'bandwidth')
    .trim()
    .toLowerCase();
  const cacheMode =
    cacheModeRaw === 'off' || cacheModeRaw === 'conservative' || cacheModeRaw === 'bandwidth'
      ? cacheModeRaw
      : 'bandwidth';

  return {
    cacheMode,
    timeoutMs: getEnvNumber(env, 'PROXY_TIMEOUT_MS', 10_000, 1_000),
    retryCount: getEnvNumber(env, 'PROXY_RETRY_COUNT', 1, 0),
  };
}

function getResourceType(targetUrl, contentType) {
  const pathname = getPathname(targetUrl);
  const typeValue = (contentType || '').toLowerCase();

  if (pathname.endsWith('.m3u8') || isManifestContentType(typeValue)) {
    return 'manifest';
  }

  if (
    pathname.endsWith('.ts') ||
    pathname.endsWith('.m4s') ||
    pathname.endsWith('.mp4') ||
    typeValue.startsWith('video/')
  ) {
    return 'segment';
  }

  if (pathname.endsWith('.vtt') || typeValue.includes('text/vtt')) {
    return 'captions';
  }

  if (
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.jpeg') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.webp') ||
    pathname.endsWith('.gif') ||
    pathname.endsWith('.avif') ||
    typeValue.startsWith('image/')
  ) {
    return 'image';
  }

  return 'other';
}

function resolveCacheControl(cacheMode, targetUrl, contentType, upstreamCacheControl) {
  if (cacheMode === 'off') {
    return upstreamCacheControl || null;
  }

  const resourceType = getResourceType(targetUrl, contentType);
  if (cacheMode === 'conservative') {
    if (resourceType === 'manifest') {
      return 'public, max-age=4, s-maxage=4, stale-while-revalidate=12';
    }
    if (resourceType === 'segment') {
      return 'public, max-age=3600, s-maxage=3600';
    }
    if (resourceType === 'captions' || resourceType === 'image') {
      return 'public, max-age=1800, s-maxage=1800, stale-while-revalidate=21600';
    }
    return upstreamCacheControl || 'public, max-age=60, s-maxage=60';
  }

  if (resourceType === 'manifest') {
    return 'public, max-age=6, s-maxage=6, stale-while-revalidate=15';
  }
  if (resourceType === 'segment') {
    return 'public, max-age=86400, s-maxage=86400, immutable';
  }
  if (resourceType === 'captions' || resourceType === 'image') {
    return 'public, max-age=21600, s-maxage=21600, stale-while-revalidate=86400';
  }
  return upstreamCacheControl || 'public, max-age=120, s-maxage=120';
}

function isRetryableStatus(status) {
  return (
    status === 204 ||
    status === 403 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 520 ||
    status === 521 ||
    status === 522 ||
    status === 523 ||
    status === 524 ||
    status === 525 ||
    status === 526
  );
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

const proxyCorsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range',
  'Access-Control-Expose-Headers':
    'Content-Type, Content-Length, Content-Range, Accept-Ranges, Cache-Control, ETag, Last-Modified',
  Vary: 'Origin',
};
const preferredAttemptByHost = new Map();

function applyProxyCorsHeaders(headers) {
  Object.entries(proxyCorsHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });
}

function attemptSignature(attempt) {
  return `${attempt.referer || 'none'}|${attempt.includeOrigin ? 'origin' : 'no-origin'}`;
}

async function fetchWithRedirects(url, headers, timeoutMs, maxRedirects = 5) {
  let currentUrl = url;
  let lastResponse = null;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetchWithTimeout(
      currentUrl,
      {
        method: 'GET',
        headers,
        redirect: 'manual',
      },
      timeoutMs
    );

    lastResponse = response;
    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      return response;
    }

    currentUrl = toAbsoluteUrl(location, currentUrl);
  }

  return lastResponse;
}

async function fetchWithRedirectRetries(url, headers, timeoutMs, retryCount) {
  let lastResponse = null;
  let lastError = null;

  for (let retry = 0; retry <= retryCount; retry += 1) {
    try {
      const response = await fetchWithRedirects(url, headers, timeoutMs);
      lastResponse = response;
      if (!isRetryableStatus(response.status)) {
        return response;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) {
    return lastResponse;
  }
  throw lastError || new Error('upstream fetch failed');
}

export function proxyOptionsHandler() {
  return new Response(null, {
    status: 204,
    headers: proxyCorsHeaders,
  });
}

export async function proxyHandler(c) {
  const { cacheMode, timeoutMs, retryCount } = getProxyRuntimeConfig(c);

  const targetUrlRaw = c.req.query('url') || c.req.query('u');
  const referer = c.req.query('referer') || 'https://megacloud.tv';
  const hostOverride = c.req.query('host');
  const clientRange = c.req.header('range');
  const targetUrl = targetUrlRaw?.replaceAll(' ', '+') || null;

  if (!targetUrl || !isHttpUrl(targetUrl)) {
    return c.json(
      {
        success: false,
        message: 'invalid "url" query parameter (or use "u")',
      },
      400,
      proxyCorsHeaders
    );
  }

  const buildRequestHeaders = (requestReferer, includeOrigin) => {
    const requestHeaders = new Headers();
    requestHeaders.set('Accept', 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*');
    requestHeaders.set(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    requestHeaders.set('Accept-Language', 'en-US,en;q=0.9');

    if (requestReferer) {
      requestHeaders.set('Referer', requestReferer);
      if (includeOrigin) {
        try {
          requestHeaders.set('Origin', new URL(requestReferer).origin);
        } catch {
          // noop
        }
      }
    }
    if (clientRange) {
      requestHeaders.set('Range', clientRange);
    }
    if (hostOverride) {
      try {
        requestHeaders.set('Host', hostOverride);
      } catch {
        // Some runtimes disallow host override, ignore safely.
      }
    }
    return requestHeaders;
  };

  const targetOriginReferer = (() => {
    try {
      return `${new URL(targetUrl).origin}/`;
    } catch {
      return null;
    }
  })();

  const inputRefererRaw = String(referer || '').trim();
  const normalizedInputReferer = (() => {
    if (!inputRefererRaw) {
      return null;
    }
    try {
      return `${new URL(inputRefererRaw).origin}/`;
    } catch {
      return inputRefererRaw;
    }
  })();

  const fallbackAttempts = [
    { referer: inputRefererRaw || null, includeOrigin: true },
    { referer: inputRefererRaw || null, includeOrigin: false },
    { referer: normalizedInputReferer, includeOrigin: true },
    { referer: normalizedInputReferer, includeOrigin: false },
    { referer: targetOriginReferer, includeOrigin: true },
    { referer: targetOriginReferer, includeOrigin: false },
    { referer: 'https://hianime.dk/', includeOrigin: true },
    { referer: 'https://hianime.dk/', includeOrigin: false },
    { referer: 'https://player.hianime.dk/', includeOrigin: true },
    { referer: 'https://player.hianime.dk/', includeOrigin: false },
    { referer: 'https://hianimes.se/', includeOrigin: true },
    { referer: 'https://hianimes.se/', includeOrigin: false },
    { referer: 'https://myani.cfd/', includeOrigin: true },
    { referer: 'https://myani.cfd/', includeOrigin: false },
    { referer: 'https://9animes.cv/', includeOrigin: true },
    { referer: 'https://9animes.cv/', includeOrigin: false },
    { referer: 'https://hianime.to/', includeOrigin: true },
    { referer: 'https://hianime.to/', includeOrigin: false },
    { referer: 'https://hianime.sx/', includeOrigin: true },
    { referer: 'https://hianime.sx/', includeOrigin: false },
    { referer: 'https://megacloud.tv/', includeOrigin: true },
    { referer: 'https://megacloud.tv/', includeOrigin: false },
    { referer: null, includeOrigin: false },
  ];

  const seenAttempts = new Set();
  const uniqueAttempts = fallbackAttempts.filter((attempt) => {
    const key = attemptSignature(attempt);
    if (seenAttempts.has(key)) {
      return false;
    }
    seenAttempts.add(key);
    return true;
  });

  const targetHostKey = (() => {
    try {
      return new URL(targetUrl).host;
    } catch {
      return '';
    }
  })();
  const preferredSignature = targetHostKey ? preferredAttemptByHost.get(targetHostKey) : undefined;
  const orderedAttempts = preferredSignature
    ? [
        ...uniqueAttempts.filter((attempt) => attemptSignature(attempt) === preferredSignature),
        ...uniqueAttempts.filter((attempt) => attemptSignature(attempt) !== preferredSignature),
      ]
    : uniqueAttempts;

  let upstream = null;
  let upstreamError = null;
  for (const attempt of orderedAttempts) {
    try {
      const response = await fetchWithRedirectRetries(
        targetUrl,
        buildRequestHeaders(attempt.referer, attempt.includeOrigin),
        timeoutMs,
        retryCount
      );

      upstream = response;
      if (!isRetryableStatus(response.status) && response.ok && targetHostKey) {
        preferredAttemptByHost.set(targetHostKey, attemptSignature(attempt));
        if (preferredAttemptByHost.size > 200) {
          const oldestKey = preferredAttemptByHost.keys().next().value;
          preferredAttemptByHost.delete(oldestKey);
        }
      }
      if (!isRetryableStatus(response.status)) {
        break;
      }
    } catch (error) {
      upstreamError = error;
    }
  }

  if (!upstream || !upstream.ok || isRetryableStatus(upstream.status)) {
    if (!upstream && upstreamError) {
      const isTimeout = upstreamError?.name === 'AbortError';
      const status = isTimeout ? 504 : 502;
      const reason = isTimeout ? 'timeout' : 'network';
      return c.text(`upstream fetch failed (${reason})`, status, proxyCorsHeaders);
    }

    const status = upstream?.status || 502;
    const errorStatus = status === 204 ? 502 : status;
    const reason = status === 204 ? '204 empty response' : String(status);
    return c.text(`upstream fetch failed (${reason})`, errorStatus, proxyCorsHeaders);
  }

  const contentType = upstream.headers.get('content-type') || '';
  const responseHeaders = new Headers();
  if (contentType) {
    responseHeaders.set('Content-Type', contentType);
  }
  if (isVttUrl(targetUrl)) {
    // Some upstreams incorrectly return octet-stream for WebVTT; force correct type for HTML track parsing.
    responseHeaders.set('Content-Type', 'text/vtt; charset=utf-8');
  }

  const cacheControl = resolveCacheControl(
    cacheMode,
    targetUrl,
    contentType,
    upstream.headers.get('cache-control')
  );
  if (cacheControl) {
    responseHeaders.set('Cache-Control', cacheControl);
  }

  const headerPassThrough = [
    'content-length',
    'content-range',
    'accept-ranges',
    'etag',
    'last-modified',
  ];
  headerPassThrough.forEach((headerName) => {
    const value = upstream.headers.get(headerName);
    if (value) {
      responseHeaders.set(headerName, value);
    }
  });

  applyProxyCorsHeaders(responseHeaders);

  if (targetUrl.includes('.m3u8') || isManifestContentType(contentType)) {
    const manifest = await upstream.text();
    const rewritten = rewriteManifest(manifest, targetUrl);
    if (!contentType) {
      responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
    }
    return new Response(rewritten, {
      status: upstream.status,
      headers: responseHeaders,
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

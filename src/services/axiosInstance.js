import config from '../config/config.js';
import { collectError } from '../workers/errorCollector.worker.js';

function classifyFetchError(error) {
  if (!error) {
    return 'unknown';
  }
  const name = typeof error === 'object' && error !== null ? error.name : '';
  const message =
    typeof error === 'object' && error !== null ? String(error.message || '') : String(error);
  const normalizedMessage = message.toLowerCase();

  if (name === 'AbortError' || normalizedMessage.includes('aborted')) {
    return 'aborted';
  }
  if (normalizedMessage.includes('timeout')) {
    return 'timeout';
  }
  if (
    normalizedMessage.includes('network') ||
    normalizedMessage.includes('failed to fetch') ||
    normalizedMessage.includes('econnrefused') ||
    normalizedMessage.includes('enotfound')
  ) {
    return 'network';
  }

  return 'unknown';
}

function buildSnippet(input, limit = 600) {
  const text = String(input || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...`;
}

export const axiosInstance = async (endpoint) => {
  const upstreamUrl = `${config.baseurl}${endpoint}`;
  const startTime = Date.now();

  try {
    const response = await fetch(upstreamUrl, {
      headers: {
        ...(config.headers || {}),
      },
    });

    const durationMs = Date.now() - startTime;
    if (!response.ok) {
      const responseBody = await response.text().catch(() => '');
      const report = collectError({
        source: 'upstream-fetch',
        reason: 'http-error',
        message: `Upstream request failed with HTTP ${response.status}`,
        method: 'GET',
        path: endpoint,
        upstreamUrl,
        statusCode: response.status,
        durationMs,
        details: {
          statusText: response.statusText || null,
          responseSnippet: buildSnippet(responseBody),
        },
      });

      return {
        success: false,
        message: `HTTP ${response.status}`,
        details: {
          reason: 'http-error',
          statusCode: response.status,
          statusText: response.statusText || null,
          durationMs,
          errorId: report?.id || null,
        },
      };
    }

    const data = await response.text();

    return {
      success: true,
      data,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const message = error?.message || 'upstream fetch failed';
    const reason = classifyFetchError(error);
    const report = collectError({
      source: 'upstream-fetch',
      reason,
      message,
      method: 'GET',
      path: endpoint,
      upstreamUrl,
      durationMs,
      details: {
        name: error?.name || null,
      },
      stack: error?.stack || null,
    });

    return {
      success: false,
      message,
      details: {
        reason,
        durationMs,
        errorId: report?.id || null,
      },
    };
  }
};

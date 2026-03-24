import { OpenAPIHono } from '@hono/zod-openapi';
import { rateLimiter } from 'hono-rate-limiter';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { fail } from '../utils/response.js';
import { AppError } from '../utils/errors.js';
import zodValidationHook from '../middlewares/hook.js';
import { htmlAsString } from '../utils/htmlAsString.js';
import { collectError } from '../workers/errorCollector.worker.js';

function getEnvNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRuntimeEnv() {
  const processEnv = typeof process !== 'undefined' && process?.env ? process.env : {};
  const workerEnv =
    typeof globalThis !== 'undefined' &&
    globalThis.__APP_RUNTIME_ENV__ &&
    typeof globalThis.__APP_RUNTIME_ENV__ === 'object'
      ? globalThis.__APP_RUNTIME_ENV__
      : {};

  return {
    ...processEnv,
    ...workerEnv,
  };
}

function parseCorsOrigins(rawOrigin) {
  if (!rawOrigin) {
    return {
      allowAll: true,
      exactOrigins: [],
      hosts: [],
    };
  }

  const parsed = String(rawOrigin)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!parsed.length || parsed.includes('*')) {
    return {
      allowAll: true,
      exactOrigins: [],
      hosts: [],
    };
  }

  const exactOrigins = new Set();
  const hosts = new Set();

  parsed.forEach((entry) => {
    const normalized = entry.trim();
    if (!normalized) {
      return;
    }

    if (/^https?:\/\//i.test(normalized)) {
      try {
        const url = new URL(normalized);
        exactOrigins.add(url.origin.toLowerCase());
      } catch {
        // ignore malformed entries
      }
      return;
    }

    const hostOnly = normalized
      .replace(/^\*\./, '')
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '')
      .toLowerCase();

    if (hostOnly) {
      hosts.add(hostOnly);
    }
  });

  return {
    allowAll: false,
    exactOrigins: [...exactOrigins],
    hosts: [...hosts],
  };
}

function resolveCorsOrigin(origin, corsConfig) {
  if (corsConfig.allowAll) {
    return '*';
  }

  if (!origin) {
    return '';
  }

  try {
    const parsed = new URL(origin);
    const requestOrigin = parsed.origin.toLowerCase();
    const requestHost = parsed.hostname.toLowerCase();

    if (corsConfig.exactOrigins.includes(requestOrigin)) {
      return origin;
    }

    if (corsConfig.hosts.includes(requestHost)) {
      return origin;
    }
  } catch {
    return '';
  }

  return '';
}

export function createRouter() {
  return new OpenAPIHono({
    defaultHook: zodValidationHook,
    strict: false,
  });
}

export default function createApp() {
  const env = getRuntimeEnv();
  const origins = parseCorsOrigins(env.ORIGIN);

  const corsConf = cors({
    origin: (origin) => resolveCorsOrigin(origin, origins),
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-error-collector-token', 'Accept'],
  });
  const rateLimiterConf = rateLimiter({
    windowMs: getEnvNumber(env.RATE_LIMIT_WINDOW_MS, 60 * 1000),
    limit: getEnvNumber(env.RATE_LIMIT_LIMIT, 100),
    skip: (c) => c.req.path.startsWith('/api/v1/proxy'),
    standardHeaders: 'draft-6', // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
    keyGenerator: (c) => {
      const ip = (c.req.header('x-forwarded-for') || '').split(',')[0].trim();
      return ip;
    },
  });

  const app = createRouter()
    .use(corsConf)
    .options('*', corsConf)
    .use(rateLimiterConf)
    .use('/api/v1/*', logger())
    .get('/', (c) => c.html(htmlAsString))
    .get('/api', (c) => c.html(htmlAsString))
    .get('/ping', (c) => c.text('pong'))
    .get('/api/ping', (c) => c.text('pong'))
    .notFound((c) => fail(c, 'page not found', 404))
    .onError((err, c) => {
      const statusCode = err instanceof AppError ? err.statusCode : 500;
      const errorReport = collectError({
        source: 'app-onerror',
        reason: err instanceof AppError ? 'app-error' : 'unhandled-error',
        message: err?.message || 'unexpected error',
        method: c.req.method,
        path: c.req.path,
        statusCode,
        details: err instanceof AppError ? err.details : null,
        stack: err?.stack || null,
      });

      if (err instanceof AppError) {
        const details =
          err.details && typeof err.details === 'object'
            ? { ...err.details, errorId: errorReport?.id || null }
            : errorReport?.id
              ? { errorId: errorReport.id }
              : err.details;
        return fail(c, err.message, err.statusCode, details);
      }
      console.error('unexpacted Error :' + err.message);
      return fail(
        c,
        'internal server error',
        500,
        errorReport?.id ? { errorId: errorReport.id } : null
      );
    });

  return app;
}

const COLLECTOR_STATE_KEY = '__HIA_ERROR_COLLECTOR_STATE__';

function getEnvNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getEnvBoolean(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function getRuntimeEnv(runtimeEnv = null) {
  const processEnv = typeof process !== 'undefined' && process?.env ? process.env : {};
  const workerEnv =
    typeof globalThis !== 'undefined' &&
    globalThis.__APP_RUNTIME_ENV__ &&
    typeof globalThis.__APP_RUNTIME_ENV__ === 'object'
      ? globalThis.__APP_RUNTIME_ENV__
      : {};

  if (runtimeEnv && typeof runtimeEnv === 'object') {
    return {
      ...processEnv,
      ...workerEnv,
      ...runtimeEnv,
    };
  }

  return {
    ...processEnv,
    ...workerEnv,
  };
}

function getCollectorState(runtimeEnv = null) {
  const env = getRuntimeEnv(runtimeEnv);
  const maxEntries = Math.max(20, getEnvNumber(env.ERROR_COLLECTOR_MAX_ENTRIES, 250));

  if (!globalThis[COLLECTOR_STATE_KEY]) {
    globalThis[COLLECTOR_STATE_KEY] = {
      sequence: 0,
      maxEntries,
      records: [],
    };
  }

  const state = globalThis[COLLECTOR_STATE_KEY];
  state.maxEntries = maxEntries;
  return state;
}

function normalizeText(value, maxLength = 600) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function normalizeStatusCode(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (parsed < 100 || parsed > 599) {
    return null;
  }
  return Math.trunc(parsed);
}

export function collectError(payload = {}, runtimeEnv = null) {
  const env = getRuntimeEnv(runtimeEnv);
  const enabled = getEnvBoolean(env.ERROR_COLLECTOR_ENABLED, true);
  if (!enabled) {
    return null;
  }

  const includeStack = getEnvBoolean(env.ERROR_COLLECTOR_INCLUDE_STACK, false);
  const state = getCollectorState(env);
  const now = new Date();
  const nextSequence = ++state.sequence;
  const recordId = `${now.getTime().toString(36)}-${nextSequence.toString(36)}`;

  const record = {
    id: recordId,
    timestamp: now.toISOString(),
    source: normalizeText(payload.source, 120) || 'unknown',
    reason: normalizeText(payload.reason, 120) || 'unknown',
    message: normalizeText(payload.message, 1000) || 'unknown error',
    method: normalizeText(payload.method, 12),
    path: normalizeText(payload.path, 500),
    upstreamUrl: normalizeText(payload.upstreamUrl, 1000),
    statusCode: normalizeStatusCode(payload.statusCode),
    durationMs:
      typeof payload.durationMs === 'number' && Number.isFinite(payload.durationMs)
        ? Math.max(0, Math.round(payload.durationMs))
        : null,
    details: payload.details ?? null,
  };

  if (includeStack) {
    record.stack = normalizeText(payload.stack, 4000);
  }

  state.records.unshift(record);
  if (state.records.length > state.maxEntries) {
    state.records.length = state.maxEntries;
  }

  return record;
}

export function getCollectedErrors(filters = {}, runtimeEnv = null) {
  const state = getCollectorState(runtimeEnv);
  const limit = Math.min(200, Math.max(1, Number(filters.limit) || 50));
  const source = normalizeText(filters.source, 120);
  const reason = normalizeText(filters.reason, 120);
  const statusCode = normalizeStatusCode(filters.statusCode);
  const routeContains = normalizeText(filters.route, 200);
  const sinceDate = filters.since ? new Date(filters.since) : null;
  const sinceTime = sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate.getTime() : null;

  let records = state.records;

  if (source) {
    records = records.filter((item) => item.source === source);
  }
  if (reason) {
    records = records.filter((item) => item.reason === reason);
  }
  if (statusCode) {
    records = records.filter((item) => item.statusCode === statusCode);
  }
  if (routeContains) {
    const needle = routeContains.toLowerCase();
    records = records.filter((item) => {
      const path = (item.path || '').toLowerCase();
      const upstreamUrl = (item.upstreamUrl || '').toLowerCase();
      return path.includes(needle) || upstreamUrl.includes(needle);
    });
  }
  if (sinceTime) {
    records = records.filter((item) => {
      const itemTime = new Date(item.timestamp).getTime();
      return Number.isFinite(itemTime) && itemTime >= sinceTime;
    });
  }

  return {
    totalStored: state.records.length,
    totalMatched: records.length,
    maxEntries: state.maxEntries,
    items: records.slice(0, limit),
  };
}

const LOCAL_STATUS_URL = 'http://localhost:5050/api/v1/maintenance/status';
const REMOTE_STATUS_URL = 'https://api.devxjin.site/api/v1/maintenance/status';

let cachedSnapshot = {
  enabled: false,
  updatedBy: null,
  updatedAt: null,
  expiresAt: 0,
};

function getEnvNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getEnvBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function resolveStatusUrl(env) {
  const explicit = String(env.LOGGER_MAINTENANCE_STATUS_URL || '').trim();
  if (explicit) {
    return explicit;
  }

  const runtimeMode = String(env.NODE_ENV || '')
    .trim()
    .toLowerCase();
  if (runtimeMode !== 'production') {
    return LOCAL_STATUS_URL;
  }

  return REMOTE_STATUS_URL;
}

function withTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function parseSnapshotResponse(payload) {
  const maintenance = payload?.data?.maintenance;
  if (!maintenance || typeof maintenance !== 'object') {
    throw new Error('Invalid maintenance response payload.');
  }

  return {
    enabled: Boolean(maintenance.enabled),
    updatedBy: maintenance.updatedBy || null,
    updatedAt: maintenance.updatedAt || null,
  };
}

async function fetchMaintenanceSnapshot(env) {
  const statusUrl = resolveStatusUrl(env);
  const timeoutMs = Math.max(500, getEnvNumber(env.LOGGER_MAINTENANCE_TIMEOUT_MS, 2500));

  const { signal, clear } = withTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`Maintenance check failed with status ${response.status}.`);
    }

    const payload = await response.json();
    return parseSnapshotResponse(payload);
  } finally {
    clear();
  }
}

export async function getMaintenanceSnapshot(env = {}) {
  const runtimeMode = String(env.NODE_ENV || '')
    .trim()
    .toLowerCase();
  if (runtimeMode === 'test' && !String(env.LOGGER_MAINTENANCE_STATUS_URL || '').trim()) {
    return {
      enabled: false,
      updatedBy: null,
      updatedAt: null,
    };
  }

  const checkEnabled = getEnvBoolean(env.LOGGER_MAINTENANCE_CHECK_ENABLED, true);
  if (!checkEnabled) {
    return {
      enabled: false,
      updatedBy: null,
      updatedAt: null,
    };
  }

  const now = Date.now();
  if (cachedSnapshot.expiresAt > now) {
    return {
      enabled: cachedSnapshot.enabled,
      updatedBy: cachedSnapshot.updatedBy,
      updatedAt: cachedSnapshot.updatedAt,
    };
  }

  const cacheMs = Math.max(500, getEnvNumber(env.LOGGER_MAINTENANCE_CACHE_MS, 10_000));
  try {
    const freshSnapshot = await fetchMaintenanceSnapshot(env);
    cachedSnapshot = {
      ...freshSnapshot,
      expiresAt: now + cacheMs,
    };
    return freshSnapshot;
  } catch {
    if (cachedSnapshot.expiresAt > 0) {
      cachedSnapshot.expiresAt = now + Math.min(cacheMs, 2_000);
      return {
        enabled: cachedSnapshot.enabled,
        updatedBy: cachedSnapshot.updatedBy,
        updatedAt: cachedSnapshot.updatedAt,
      };
    }

    return {
      enabled: false,
      updatedBy: null,
      updatedAt: null,
    };
  }
}

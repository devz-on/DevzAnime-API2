import { AppError } from '../../utils/errors.js';
import { getCollectedErrors, getRuntimeEnv } from '../../workers/errorCollector.worker.js';

function validateAccess(c) {
  const env = getRuntimeEnv();
  const configuredToken = String(env.ERROR_COLLECTOR_TOKEN || '').trim();
  if (!configuredToken) {
    return;
  }

  const providedToken = String(c.req.header('x-error-collector-token') || '').trim();
  if (!providedToken || providedToken !== configuredToken) {
    throw new AppError('forbidden', 403, {
      message: 'missing or invalid x-error-collector-token header',
    });
  }
}

export default async function errorCollectorHandler(c) {
  validateAccess(c);

  const { limit, source, reason, statusCode, route, since } = c.req.valid('query');
  return getCollectedErrors({
    limit,
    source,
    reason,
    statusCode,
    route,
    since,
  });
}

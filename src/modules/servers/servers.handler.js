import { getServersData as getProviderServersData } from '../../services/providerDetails.js';
import {
  getHindiServersFallback,
  isLikelyHindiEpisodeIdentifier,
  isServersResponseEmpty,
  shouldFallbackToHindiOnError,
} from '../../services/hindiFallback.js';

function toPublicServersPayload(payload) {
  const publicPayload = { ...(payload || {}) };
  delete publicPayload._subRaw;
  delete publicPayload._dubRaw;
  return publicPayload;
}

export default async function serversHandler(c) {
  const { id } = c.req.valid('param');
  return getServers(id, c);
}

export async function getServers(id, c) {
  if (isLikelyHindiEpisodeIdentifier(id)) {
    return getHindiServersFallback(id, c);
  }

  try {
    const response = toPublicServersPayload(await getProviderServersData(id, c));
    if (!isServersResponseEmpty(response)) {
      return response;
    }

    return getHindiServersFallback(id, c);
  } catch (error) {
    if (shouldFallbackToHindiOnError(error)) {
      return getHindiServersFallback(id, c);
    }
    throw error;
  }
}

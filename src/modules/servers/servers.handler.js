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
    return await getHindiServersFallback(id, c);
  }

  const emptyResponse = {
    episode: 0,
    sub: [],
    dub: [],
  };

  try {
    const response = toPublicServersPayload(await getProviderServersData(id, c));
    if (!isServersResponseEmpty(response)) {
      return response;
    }

    try {
      const fallbackResponse = await getHindiServersFallback(id, c);
      if (!isServersResponseEmpty(fallbackResponse)) {
        return fallbackResponse;
      }
    } catch {
      // Keep provider result when Hindi fallback lookup fails.
    }

    return response || emptyResponse;
  } catch (error) {
    if (shouldFallbackToHindiOnError(error)) {
      try {
        const fallbackResponse = await getHindiServersFallback(id, c);
        if (!isServersResponseEmpty(fallbackResponse)) {
          return fallbackResponse;
        }
      } catch {
        // Keep stable empty payload on fallback errors for non-Hindi ids.
      }

      return emptyResponse;
    }
    throw error;
  }
}

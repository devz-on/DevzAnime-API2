import { getServersData } from '../../services/providerDetails.js';
import {
  getHindiServersFallback,
  isLikelyHindiEpisodeIdentifier,
  shouldFallbackToHindiOnError,
} from '../../services/hindiFallback.js';

export default async function (c) {
  const { id } = c.req.valid('param');

  const response = await getServers(id, c);

  return response;
}

export async function getServers(id, c) {
  if (isLikelyHindiEpisodeIdentifier(id)) {
    return getHindiServersFallback(id, c);
  }

  try {
    return await getServersData(id, c);
  } catch (error) {
    if (!shouldFallbackToHindiOnError(error)) {
      throw error;
    }
    try {
      return await getHindiServersFallback(id, c);
    } catch {
      throw error;
    }
  }
}

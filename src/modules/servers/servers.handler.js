import { getServersData } from '../../services/providerDetails.js';
import {
  getHindiServersFallback,
  isLikelyHindiAnimeIdentifier,
  isLikelyHindiEpisodeIdentifier,
  isServersResponseEmpty,
  shouldFallbackToHindiOnError,
} from '../../services/hindiFallback.js';

export default async function (c) {
  const { id } = c.req.valid('param');

  const shouldBypassPrimary =
    isLikelyHindiEpisodeIdentifier(id) || isLikelyHindiAnimeIdentifier(id);

  let data = null;
  if (shouldBypassPrimary) {
    data = await getHindiServersFallback(id, c);
  } else {
    try {
      data = await getServersData(id, c);
    } catch (error) {
      if (!shouldFallbackToHindiOnError(error)) {
        throw error;
      }
      data = await getHindiServersFallback(id, c);
    }

    if (isServersResponseEmpty(data)) {
      try {
        const fallbackData = await getHindiServersFallback(id, c);
        if (!isServersResponseEmpty(fallbackData)) {
          data = fallbackData;
        }
      } catch {
        // Keep primary no-data response.
      }
    }
  }

  return {
    episode: data.episode,
    sub: data.sub,
    dub: data.dub,
  };
}

export async function getServers(id) {
  const data = await getServersData(id, null);
  return {
    episode: data.episode,
    sub: data.sub,
    dub: data.dub,
  };
}

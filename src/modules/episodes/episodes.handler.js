import { getEpisodesData } from '../../services/providerDetails.js';
import {
  getHindiEpisodesFallback,
  isEpisodesResponseEmpty,
  isLikelyHindiAnimeIdentifier,
  shouldFallbackToHindiOnError,
} from '../../services/hindiFallback.js';

export default async function episodesHandler(c) {
  const { id } = c.req.valid('param');

  if (isLikelyHindiAnimeIdentifier(id)) {
    return await getHindiEpisodesFallback(id, c);
  }

  try {
    const response = await getEpisodesData(id, c);
    if (!isEpisodesResponseEmpty(response)) {
      return response;
    }

    try {
      const fallbackResponse = await getHindiEpisodesFallback(id, c);
      if (!isEpisodesResponseEmpty(fallbackResponse)) {
        return fallbackResponse;
      }
    } catch {
      // Keep provider response when Hindi fallback lookup fails.
    }

    return response;
  } catch (error) {
    if (shouldFallbackToHindiOnError(error)) {
      try {
        const fallbackResponse = await getHindiEpisodesFallback(id, c);
        if (!isEpisodesResponseEmpty(fallbackResponse)) {
          return fallbackResponse;
        }
      } catch {
        // Preserve original upstream error when fallback is unavailable.
      }
    }
    throw error;
  }
}

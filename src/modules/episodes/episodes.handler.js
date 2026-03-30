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
    return getHindiEpisodesFallback(id, c);
  }

  let primaryResponse = null;
  try {
    primaryResponse = await getEpisodesData(id, c);
  } catch (error) {
    if (!shouldFallbackToHindiOnError(error)) {
      throw error;
    }
    return getHindiEpisodesFallback(id, c);
  }

  if (!isEpisodesResponseEmpty(primaryResponse)) {
    return primaryResponse;
  }

  try {
    const fallbackResponse = await getHindiEpisodesFallback(id, c);
    return isEpisodesResponseEmpty(fallbackResponse) ? primaryResponse : fallbackResponse;
  } catch {
    return primaryResponse;
  }
}

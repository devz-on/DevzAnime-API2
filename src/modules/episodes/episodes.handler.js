import { getEpisodesData } from '../../services/providerDetails.js';
import {
  getHindiEpisodesFallback,
  isLikelyHindiAnimeIdentifier,
  shouldFallbackToHindiOnError,
} from '../../services/hindiFallback.js';

export default async function episodesHandler(c) {
  const { id } = c.req.valid('param');

  if (isLikelyHindiAnimeIdentifier(id)) {
    return getHindiEpisodesFallback(id, c);
  }

  try {
    return await getEpisodesData(id, c);
  } catch (error) {
    if (!shouldFallbackToHindiOnError(error)) {
      throw error;
    }
    try {
      return await getHindiEpisodesFallback(id, c);
    } catch {
      throw error;
    }
  }
}

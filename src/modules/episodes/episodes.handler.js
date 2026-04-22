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

  try {
    const response = await getEpisodesData(id, c);
    if (!isEpisodesResponseEmpty(response)) {
      return response;
    }

    return getHindiEpisodesFallback(id, c);
  } catch (error) {
    if (shouldFallbackToHindiOnError(error)) {
      return getHindiEpisodesFallback(id, c);
    }
    throw error;
  }
}

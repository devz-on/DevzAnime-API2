import { getAnimeInfoData } from '../../../services/providerDetails.js';
import {
  getHindiAnimeInfoFallback,
  isLikelyHindiAnimeIdentifier,
  shouldFallbackToHindiOnError,
} from '../../../services/hindiFallback.js';

export default async function animeInfo(c) {
  const { id } = c.req.valid('param');

  if (isLikelyHindiAnimeIdentifier(id)) {
    return getHindiAnimeInfoFallback(id, c);
  }

  try {
    const response = await getAnimeInfoData(id, c);
    if (response && typeof response === 'object') {
      delete response._episodesRaw;
    }
    return response;
  } catch (error) {
    if (shouldFallbackToHindiOnError(error)) {
      return getHindiAnimeInfoFallback(id, c);
    }
    throw error;
  }
}

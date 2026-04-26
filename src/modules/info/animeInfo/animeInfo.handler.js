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
    return await getAnimeInfoData(id, c);
  } catch (error) {
    if (!shouldFallbackToHindiOnError(error)) {
      throw error;
    }
    try {
      return await getHindiAnimeInfoFallback(id, c);
    } catch {
      throw error;
    }
  }
}

import { getAnimeInfoData } from '../../../services/providerDetails.js';
import {
  getHindiAnimeInfoFallback,
  isLikelyHindiAnimeIdentifier,
  shouldFallbackToHindiOnError,
} from '../../../services/hindiFallback.js';

export default async function animeInfo(c) {
  const { id } = c.req.valid('param');

  let data;
  if (isLikelyHindiAnimeIdentifier(id)) {
    data = await getHindiAnimeInfoFallback(id, c);
  } else {
    try {
      data = await getAnimeInfoData(id, c);
    } catch (error) {
      if (!shouldFallbackToHindiOnError(error)) {
        throw error;
      }
      data = await getHindiAnimeInfoFallback(id, c);
    }
  }

  delete data._episodesRaw;
  return data;
}

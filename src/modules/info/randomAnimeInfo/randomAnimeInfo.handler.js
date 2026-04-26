import { getRandomAnimeInfoData } from '../../../services/providerDetails.js';

export default async function randomAnimeInfoHandler(c) {
  return getRandomAnimeInfoData(c);
}

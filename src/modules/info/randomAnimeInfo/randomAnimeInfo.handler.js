import { getRandomAnimeInfoData } from '../../../services/providerDetails.js';

export default async function randomAnimeInfoHandler(c) {
  const response = await getRandomAnimeInfoData(c);
  if (response && typeof response === 'object') {
    delete response._episodesRaw;
  }
  return response;
}

import { getRandomAnimeInfoData } from '../../../services/providerDetails.js';

export default async function randomAnimeInfoHandler(c) {
  const data = await getRandomAnimeInfoData(c);
  delete data._episodesRaw;
  return data;
}

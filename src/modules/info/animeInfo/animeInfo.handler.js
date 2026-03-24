import { getAnimeInfoData } from '../../../services/providerDetails.js';

export default async function animeInfo(c) {
  const { id } = c.req.valid('param');
  const data = await getAnimeInfoData(id, c);
  delete data._episodesRaw;
  return data;
}

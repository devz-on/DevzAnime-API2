import { getEpisodesData } from '../../services/providerDetails.js';

export default async function episodesHandler(c) {
  const { id } = c.req.valid('param');
  return getEpisodesData(id, c);
}

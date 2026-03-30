import { getHindiDubbedAnimeDetailsData } from '../../services/desiDubStream.js';

export default async function hindiDubbedDetailsHandler(c) {
  const { id } = c.req.valid('param');
  return getHindiDubbedAnimeDetailsData(id, c);
}

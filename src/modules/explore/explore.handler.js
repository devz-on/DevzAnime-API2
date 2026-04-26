import { getExploreData } from '../../services/providerContent.js';

export default async function exploreHandler(c) {
  const { query } = c.req.valid('param');
  const { page } = c.req.valid('query');
  return getExploreData(query, page, c);
}

import { NotFoundError } from '../../utils/errors.js';
import { getExploreData } from '../../services/providerContent.js';

export default async function exploreHandler(c) {
  const { query } = c.req.valid('param');
  const { page } = c.req.valid('query');

  const response = await getExploreData(query, page, c);

  if (response.response.length < 1) throw new NotFoundError();
  return response;
}

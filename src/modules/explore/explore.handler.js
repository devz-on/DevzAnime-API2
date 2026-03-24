import { getExploreData } from '../../services/providerContent.js';
import { validationError } from '../../utils/errors.js';

export default async function exploreHandler(c) {
  const { query } = c.req.valid('param');
  const { page } = c.req.valid('query');
  try {
    return await getExploreData(query, page, c);
  } catch (error) {
    throw new validationError(error?.message || 'failed to fetch explore data');
  }
}

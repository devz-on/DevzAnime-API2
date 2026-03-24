import { getFilterData } from '../../../services/providerContent.js';

export default async function filterHandler(c) {
  const query = c.req.valid('query');
  return getFilterData(query, c);
}

import { getSearchData } from '../../../services/providerContent.js';

export default async function searchHandler(c) {
  const { page, keyword } = c.req.valid('query');
  return getSearchData(keyword, page, c);
}

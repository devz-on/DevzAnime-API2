import { getHindiDubbedSearchData } from '../../services/desiDub.js';

export default async function hindiDubbedSearchHandler(c) {
  const { keyword, page, mappedOnly } = c.req.valid('query');
  return getHindiDubbedSearchData(keyword, page, mappedOnly, c);
}

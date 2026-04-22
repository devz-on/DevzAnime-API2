import { getSearchData } from '../../../services/providerContent.js';
import { getHindiSearchFallback, isSearchResponseEmpty } from '../../../services/hindiFallback.js';

export default async function searchHandler(c) {
  const { page, keyword } = c.req.valid('query');

  try {
    const response = await getSearchData(keyword, page, c);
    if (!isSearchResponseEmpty(response)) {
      return response;
    }
  } catch {
    // Fall through to Hindi fallback when normal source is unavailable.
  }

  return getHindiSearchFallback(keyword, page, c);
}

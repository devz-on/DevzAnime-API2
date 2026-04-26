import { getSearchData } from '../../../services/providerContent.js';
import { getHindiSearchFallback, isSearchResponseEmpty } from '../../../services/hindiFallback.js';

export default async function searchHandler(c) {
  const { page, keyword } = c.req.valid('query');
  const response = await getSearchData(keyword, page, c);
  if (!isSearchResponseEmpty(response)) {
    return response;
  }

  try {
    const fallback = await getHindiSearchFallback(keyword, page, c);
    if (!isSearchResponseEmpty(fallback)) {
      return fallback;
    }
  } catch (fallbackError) {
    void fallbackError;
  }

  return response;
}

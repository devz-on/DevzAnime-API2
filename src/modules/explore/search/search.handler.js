import { getSearchData } from '../../../services/providerContent.js';
import {
  getHindiSearchFallback,
  isSearchResponseEmpty,
  shouldFallbackToHindiOnError,
} from '../../../services/hindiFallback.js';

export default async function searchHandler(c) {
  const { page, keyword } = c.req.valid('query');
  let primaryResponse = null;

  try {
    primaryResponse = await getSearchData(keyword, page, c);
  } catch (error) {
    if (!shouldFallbackToHindiOnError(error)) {
      throw error;
    }
    return getHindiSearchFallback(keyword, page, c);
  }

  if (!isSearchResponseEmpty(primaryResponse)) {
    return primaryResponse;
  }

  try {
    const fallbackResponse = await getHindiSearchFallback(keyword, page, c);
    return isSearchResponseEmpty(fallbackResponse) ? primaryResponse : fallbackResponse;
  } catch {
    return primaryResponse;
  }
}

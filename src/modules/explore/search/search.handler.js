import { getSearchData } from '../../../services/providerContent.js';
import {
  getHindiSearchFallback,
  isSearchResponseEmpty,
  shouldFallbackToHindiOnError,
} from '../../../services/hindiFallback.js';
import { toSafeString } from '../../../services/normalizers.js';

export default async function searchHandler(c) {
  const { page, keyword } = c.req.valid('query');
  const normalizedKeyword = toSafeString(keyword).toLowerCase();

  if (normalizedKeyword.includes('hindi')) {
    try {
      return await getHindiSearchFallback(keyword, page, c);
    } catch {
      // fall through to primary provider search
    }
  }

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

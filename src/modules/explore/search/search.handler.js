import exploreExtract from '../explore.extract.js';
import { axiosInstance } from '../../../services/axiosInstance.js';
import { getHindiSearchFallback, isSearchResponseEmpty } from '../../../services/hindiFallback.js';
import createEndpoint from '../../../utils/createEndpoint.js';
import { NotFoundError, validationError } from '../../../utils/errors.js';

export default async function searchHandler(c) {
  const { page, keyword } = c.req.valid('query');

  try {
    const endpoint = createEndpoint(`search?keyword=${keyword}`, page);

    const result = await axiosInstance(endpoint);

    if (!result.success) {
      throw new validationError('make sure given endpoint is correct');
    }
    const response = exploreExtract(result.data);

    if (response.response.length < 1) {
      throw new NotFoundError();
    }
    return response;
  } catch (error) {
    const fallback = await getHindiSearchFallback(keyword, page, c);
    if (!isSearchResponseEmpty(fallback)) {
      return fallback;
    }
    throw error;
  }
}

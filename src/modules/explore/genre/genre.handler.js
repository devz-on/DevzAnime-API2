import exploreExtract from '../explore.extract.js';
import { axiosInstance } from '../../../services/axiosInstance.js';
import createEndpoint from '../../../utils/createEndpoint.js';
import { NotFoundError, validationError } from '../../../utils/errors.js';

export default async function genreHandler(c) {
  const { genre } = c.req.valid('param');
  const { page } = c.req.valid('query');

  const endpoint = createEndpoint(`genre/${genre}`, page);

  const result = await axiosInstance(endpoint);

  if (!result.success) {
    throw new validationError('make sure given endpoint is correct');
  }
  const response = exploreExtract(result.data);

  if (response.response.length < 1) throw new NotFoundError();
  return response;
}

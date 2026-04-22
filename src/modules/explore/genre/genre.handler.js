import { NotFoundError } from '../../../utils/errors.js';
import { getGenreData } from '../../../services/providerContent.js';

export default async function genreHandler(c) {
  const { genre } = c.req.valid('param');
  const { page } = c.req.valid('query');

  const response = await getGenreData(genre, page, c);

  if (response.response.length < 1) throw new NotFoundError();
  return response;
}

import { getGenreData } from '../../../services/providerContent.js';

export default async function genreHandler(c) {
  const { genre } = c.req.valid('param');
  const { page } = c.req.valid('query');
  return getGenreData(genre, page, c);
}

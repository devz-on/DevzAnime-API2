import { getCharactersData } from '../../services/providerDetails.js';

export default async function charactersHandler(c) {
  const { id } = c.req.valid('param');
  const { page } = c.req.valid('query');
  return getCharactersData(id, page, c);
}

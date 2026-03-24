import { getCharacterData } from '../../../services/providerDetails.js';

export default async function animeCharacterHandler(c) {
  const { id } = c.req.valid('param');
  return getCharacterData(id, c);
}

import { getAzListData } from '../../../services/providerContent.js';

export default async function azListHandler(c) {
  const { letter } = c.req.valid('param');
  const { page } = c.req.valid('query');
  return getAzListData(letter, page, c);
}

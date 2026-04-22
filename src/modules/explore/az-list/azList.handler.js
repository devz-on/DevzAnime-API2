import { NotFoundError } from '../../../utils/errors.js';
import { getAzListData } from '../../../services/providerContent.js';

export default async function azListHandler(c) {
  const { letter } = c.req.valid('param');
  const { page } = c.req.valid('query');

  const response = await getAzListData(letter, page, c);

  if (response.response.length < 1) throw new NotFoundError();
  return response;
}

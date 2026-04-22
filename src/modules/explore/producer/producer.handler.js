import { NotFoundError } from '../../../utils/errors.js';
import { getProducerData } from '../../../services/providerContent.js';

export default async function producerHandler(c) {
  const { id } = c.req.valid('param');
  const { page } = c.req.valid('query');

  const response = await getProducerData(id, page, c);

  if (response.response.length < 1) throw new NotFoundError();
  return response;
}

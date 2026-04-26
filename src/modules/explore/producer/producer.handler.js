import { getProducerData } from '../../../services/providerContent.js';

export default async function producerHandler(c) {
  const { id } = c.req.valid('param');
  const { page } = c.req.valid('query');
  return getProducerData(id, page, c);
}

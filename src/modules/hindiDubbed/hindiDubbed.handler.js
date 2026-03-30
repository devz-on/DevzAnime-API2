import { getHindiDubbedData } from '../../services/desiDub.js';

export default async function hindiDubbedHandler(c) {
  const { page, mappedOnly } = c.req.valid('query');
  return getHindiDubbedData(page, mappedOnly, c);
}

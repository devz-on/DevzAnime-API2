import { getHindiDubbedData } from '../../services/desiDub.js';

export default async function hindiDubbedHandler(c) {
  const { page } = c.req.valid('query');
  return getHindiDubbedData(page, c);
}

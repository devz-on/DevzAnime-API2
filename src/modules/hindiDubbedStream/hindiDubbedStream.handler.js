import { getHindiDubbedStreamData } from '../../services/desiDubStream.js';

export default async function hindiDubbedStreamHandler(c) {
  const { id, episode, server } = c.req.valid('query');
  return getHindiDubbedStreamData(id, episode, server, c);
}

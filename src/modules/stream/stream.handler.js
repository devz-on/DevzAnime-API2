import { getStreamData } from '../../services/providerDetails.js';

export default async function streamHandler(c) {
  let { id, server, type } = c.req.valid('query');
  return getStreamData(id, server, type, c);
}

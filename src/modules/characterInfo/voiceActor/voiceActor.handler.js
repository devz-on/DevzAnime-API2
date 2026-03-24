import { getActorData } from '../../../services/providerDetails.js';

export default async function voiceActorHandler(c) {
  const { id } = c.req.valid('param');
  return getActorData(id, c);
}

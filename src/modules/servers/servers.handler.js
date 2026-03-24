import { getServersData } from '../../services/providerDetails.js';

export default async function (c) {
  const { id } = c.req.valid('param');
  const data = await getServersData(id, c);
  return {
    episode: data.episode,
    sub: data.sub,
    dub: data.dub,
  };
}

export async function getServers(id) {
  const data = await getServersData(id, null);
  return {
    episode: data.episode,
    sub: data.sub,
    dub: data.dub,
  };
}

import { getTopTenData } from '../../services/providerContent.js';

export default async function topTenHandler(c) {
  return getTopTenData(c);
}

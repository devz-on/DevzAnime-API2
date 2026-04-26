import { getTopTenData } from '../../services/providerContent.js';

export default async function topTenLegacyHandler(c) {
  return getTopTenData(c);
}

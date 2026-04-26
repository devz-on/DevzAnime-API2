import { getSpotlightData } from '../../services/providerContent.js';

export default async function spotlightLegacyHandler(c) {
  return getSpotlightData(c);
}

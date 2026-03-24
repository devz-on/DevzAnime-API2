import { getSpotlightData } from '../../services/providerContent.js';

export default async function spotlightHandler(c) {
  return getSpotlightData(c);
}

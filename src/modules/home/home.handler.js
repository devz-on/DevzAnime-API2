import { getHomeData } from '../../services/providerContent.js';

export default async function homeHandler(c) {
  return getHomeData(c);
}

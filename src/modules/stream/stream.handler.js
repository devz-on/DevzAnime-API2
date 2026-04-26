import { getStreamData } from '../../services/providerDetails.js';
import {
  getHindiStreamFallback,
  isLikelyHindiEpisodeIdentifier,
  shouldFallbackToHindiOnError,
} from '../../services/hindiFallback.js';

export default async function streamHandler(c) {
  const { id, server, type } = c.req.valid('query');

  if (isLikelyHindiEpisodeIdentifier(id)) {
    return getHindiStreamFallback(id, server, c);
  }

  try {
    return await getStreamData(id, server, type, c);
  } catch (error) {
    const shouldFallback = shouldFallbackToHindiOnError(error);
    if (!shouldFallback) {
      throw error;
    }

    try {
      return await getHindiStreamFallback(id, server, c);
    } catch {
      throw error;
    }
  }
}

import { getStreamData } from '../../services/providerDetails.js';
import {
  getHindiStreamFallback,
  isLikelyHindiAnimeIdentifier,
  isLikelyHindiEpisodeIdentifier,
  isStreamResponseEmpty,
  shouldFallbackToHindiOnError,
} from '../../services/hindiFallback.js';

export default async function streamHandler(c) {
  let { id, server, type } = c.req.valid('query');

  const shouldBypassPrimary =
    isLikelyHindiEpisodeIdentifier(id) || isLikelyHindiAnimeIdentifier(id);

  if (shouldBypassPrimary) {
    return getHindiStreamFallback(id, server, c);
  }

  let primaryResponse = null;
  try {
    primaryResponse = await getStreamData(id, server, type, c);
  } catch (error) {
    if (!shouldFallbackToHindiOnError(error)) {
      throw error;
    }
    return getHindiStreamFallback(id, server, c);
  }

  if (!isStreamResponseEmpty(primaryResponse)) {
    return primaryResponse;
  }

  try {
    const fallbackResponse = await getHindiStreamFallback(id, server, c);
    return isStreamResponseEmpty(fallbackResponse) ? primaryResponse : fallbackResponse;
  } catch {
    return primaryResponse;
  }
}

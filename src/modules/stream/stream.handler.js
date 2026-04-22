import { getStreamData as getProviderStreamData } from '../../services/providerDetails.js';
import {
  getHindiStreamFallback,
  isLikelyHindiEpisodeIdentifier,
  isStreamResponseEmpty,
  shouldFallbackToHindiOnError,
} from '../../services/hindiFallback.js';

export default async function streamHandler(c) {
  const { id, server, type } = c.req.valid('query');

  if (isLikelyHindiEpisodeIdentifier(id)) {
    return await getHindiStreamFallback(id, server, c);
  }

  try {
    const response = await getProviderStreamData(id, server, type, c);
    if (!isStreamResponseEmpty(response)) {
      return response;
    }

    try {
      const fallbackResponse = await getHindiStreamFallback(id, server, c);
      if (!isStreamResponseEmpty(fallbackResponse)) {
        return fallbackResponse;
      }
    } catch {
      // Keep provider response when Hindi fallback lookup fails.
    }

    return response;
  } catch (error) {
    if (shouldFallbackToHindiOnError(error)) {
      try {
        const fallbackResponse = await getHindiStreamFallback(id, server, c);
        if (!isStreamResponseEmpty(fallbackResponse)) {
          return fallbackResponse;
        }
      } catch {
        // Preserve original upstream error when fallback is unavailable.
      }
    }
    throw error;
  }
}

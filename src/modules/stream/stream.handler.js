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
    return getHindiStreamFallback(id, server, c);
  }

  try {
    const response = await getProviderStreamData(id, server, type, c);
    if (!isStreamResponseEmpty(response)) {
      return response;
    }

    return getHindiStreamFallback(id, server, c);
  } catch (error) {
    if (shouldFallbackToHindiOnError(error)) {
      return getHindiStreamFallback(id, server, c);
    }
    throw error;
  }
}

import { NotFoundError, validationError } from '../../utils/errors.js';
import { getServers } from '../servers/servers.handler.js';
import {
  getHindiStreamFallback,
  isLikelyHindiEpisodeIdentifier,
  isStreamResponseEmpty,
  shouldFallbackToHindiOnError,
} from '../../services/hindiFallback.js';
import streamExtract from './stream.extract.js';

export default async function streamHandler(c) {
  let { id, server, type } = c.req.valid('query');

  try {
    const servers = await getServers(id);

    const selectedServer = servers[type].find((el) => el.name === server);
    if (!selectedServer) throw new validationError('invalid or server not found', { server });

    const response = await streamExtract({ selectedServer, id });
    if (!response) throw new NotFoundError('Something Went Wrong While Decryption');
    return response;
  } catch (error) {
    const shouldFallback =
      isLikelyHindiEpisodeIdentifier(id) || shouldFallbackToHindiOnError(error);
    if (!shouldFallback) {
      throw error;
    }

    const fallback = await getHindiStreamFallback(id, server, c);
    if (isStreamResponseEmpty(fallback)) {
      throw error;
    }
    return fallback;
  }
}

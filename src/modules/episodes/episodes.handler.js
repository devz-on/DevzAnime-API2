import config from '../../config/config.js';
import episodesExtract from './episodes.extract.js';
import { NotFoundError } from '../../utils/errors.js';

export default async function episodesHandler(c) {
  const { id } = c.req.valid('param');

  const Referer = `/watch/${id}`;
  const idNum = id.split('-').at(-1);
  const ajaxUrl = `/ajax/v2/episode/list/${idNum}`;

  try {
    const res = await fetch(config.baseurl + ajaxUrl, {
      headers: {
        Referer: config.baseurl + Referer,
        ...config.headers,
      },
    });

    const data = await res.json();
    const response = episodesExtract(data.html);
    return response;
  } catch {
    throw new NotFoundError('episodes Not Found');
  }
}

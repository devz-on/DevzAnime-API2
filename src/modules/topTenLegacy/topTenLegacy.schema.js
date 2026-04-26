import z from 'zod';
import { AnimeWithEpisodesSchema } from '../globalSchema/schema.js';
import { createRoute } from '@hono/zod-openapi';

const schema = z.object({
  status: z.boolean(),
  data: z.object({
    today: z.array(AnimeWithEpisodesSchema),
    week: z.array(AnimeWithEpisodesSchema),
    month: z.array(AnimeWithEpisodesSchema),
  }),
});

const topTenLegacySchema = createRoute({
  method: 'get',
  path: '/top-10-animes',
  responses: {
    200: {
      content: {
        'application/json': {
          schema,
        },
      },
    },
  },
});

export default topTenLegacySchema;

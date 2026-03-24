import { createRoute, z } from '@hono/zod-openapi';
import { azList } from '../../../config/meta.js';
import { explorePageSchema, pageParamsSchema } from '../../globalSchema/schema.js';

const azListSchema = createRoute({
  method: 'get',
  path: '/az-list/{letter}',
  request: {
    query: z.object({
      page: pageParamsSchema,
    }),
    params: z.object({
      letter: z
        .enum(azList)
        .transform((l) => (l === 'all' ? '' : l))
        .openapi({ examples: azList }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: explorePageSchema,
        },
      },
    },
  },
  description: 'Retrieve The list Of Anime By letter example: A to Z or 0-9',
});

export default azListSchema;

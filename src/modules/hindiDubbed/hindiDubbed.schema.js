import { createRoute, z } from '@hono/zod-openapi';
import {
  AnimeWithEpisodesSchema,
  pageInfoSchema,
  pageParamsSchema,
} from '../globalSchema/schema.js';

const hindiDubbedItemSchema = AnimeWithEpisodesSchema.extend({
  streamId: z.string().optional(),
  type: z.string(),
  duration: z.string(),
});

const hindiDubbedSchema = createRoute({
  method: 'get',
  path: '/hindi-dubbed',
  request: {
    query: z.object({
      page: pageParamsSchema,
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              pageInfo: pageInfoSchema,
              response: z.array(hindiDubbedItemSchema),
            }),
          }),
        },
      },
    },
  },
  description: 'Retrieve Hindi dubbed catalog from DesiDub.',
});

export default hindiDubbedSchema;

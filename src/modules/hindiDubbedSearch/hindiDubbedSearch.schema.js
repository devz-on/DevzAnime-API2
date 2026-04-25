import { createRoute, z } from '@hono/zod-openapi';
import {
  AnimeWithEpisodesSchema,
  pageInfoSchema,
  pageParamsSchema,
} from '../globalSchema/schema.js';

const hindiDubbedSearchItemSchema = AnimeWithEpisodesSchema.extend({
  streamId: z.string().optional(),
  type: z.string(),
  duration: z.string(),
});

const hindiDubbedSearchSchema = createRoute({
  method: 'get',
  path: '/hindi-dubbed/search',
  request: {
    query: z.object({
      keyword: z
        .string()
        .min(1, 'search keyword is required')
        .transform((value) => value.trim().replaceAll(' ', '+'))
        .openapi({ example: 'attack on titan' }),
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
              response: z.array(hindiDubbedSearchItemSchema),
            }),
          }),
        },
      },
    },
  },
  description: 'Search only Hindi dubbed anime from DesiDub.',
});

export default hindiDubbedSearchSchema;

import { createRoute, z } from '@hono/zod-openapi';
import { AnimeWithEpisodesSchema, pageInfoSchema, pageParamsSchema } from '../globalSchema/schema.js';

const mappingSchema = z.object({
  mapped: z.boolean(),
  daniId: z.string().nullable(),
  method: z.enum(['override', 'exact', 'fuzzy', 'none']),
  confidence: z.number(),
  source: z.object({
    postId: z.number(),
    slug: z.string(),
    url: z.string(),
  }),
});

const mappedOnlySchema = z
  .string()
  .optional()
  .default('false')
  .transform((value) => {
    const normalized = String(value || '')
      .trim()
      .toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  })
  .openapi({ example: 'false' });

const hindiDubbedItemSchema = AnimeWithEpisodesSchema.extend({
  streamId: z.string().optional(),
  type: z.string(),
  duration: z.string(),
  mapping: mappingSchema.optional(),
});

const hindiDubbedSchema = createRoute({
  method: 'get',
  path: '/hindi-dubbed',
  request: {
    query: z.object({
      page: pageParamsSchema,
      mappedOnly: mappedOnlySchema,
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
  description:
    'Retrieve Hindi dubbed catalog from DesiDub with DAniApi mapping metadata. Use mappedOnly=true to keep only mapped rows.',
});

export default hindiDubbedSchema;

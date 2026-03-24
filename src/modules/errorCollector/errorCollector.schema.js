import { createRoute, z } from '@hono/zod-openapi';

const ErrorRecordSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  source: z.string(),
  reason: z.string(),
  message: z.string(),
  method: z.string().nullable(),
  path: z.string().nullable(),
  upstreamUrl: z.string().nullable(),
  statusCode: z.number().nullable(),
  durationMs: z.number().nullable(),
  details: z.any().nullable(),
  stack: z.string().nullable().optional(),
});

const errorCollectorSchema = createRoute({
  method: 'get',
  path: '/errors',
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).optional().default(50),
      source: z.string().trim().min(1).optional(),
      reason: z.string().trim().min(1).optional(),
      statusCode: z.coerce.number().int().min(100).max(599).optional(),
      route: z.string().trim().min(1).optional(),
      since: z.string().datetime().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              totalStored: z.number().int(),
              totalMatched: z.number().int(),
              maxEntries: z.number().int(),
              items: z.array(ErrorRecordSchema),
            }),
          }),
        },
      },
    },
  },
  description: 'Retrieve collected upstream and handler errors.',
});

export default errorCollectorSchema;

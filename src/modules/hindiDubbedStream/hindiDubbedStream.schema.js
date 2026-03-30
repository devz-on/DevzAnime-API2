import { createRoute, z } from '@hono/zod-openapi';

const streamItemSchema = z.object({
  id: z.string(),
  type: z.enum(['dub']),
  link: z.object({
    file: z.url(),
    type: z.string(),
  }),
  tracks: z.array(
    z.object({
      file: z.url(),
      label: z.string(),
      kind: z.enum(['captions', 'subtitles', 'thumbnails']).optional(),
      default: z.boolean().optional(),
    })
  ),
  intro: z.object({
    start: z.number(),
    end: z.number(),
  }),
  outro: z.object({
    start: z.number(),
    end: z.number(),
  }),
  server: z.string(),
  referer: z.string(),
  isDirect: z.boolean(),
});

const hindiDubbedStreamSchema = createRoute({
  method: 'get',
  path: '/hindi-dubbed/stream',
  request: {
    query: z.object({
      id: z
        .string()
        .min(1)
        .openapi({ example: 'desidub-5001-attack-on-titan-season-1' }),
      episode: z.coerce.number().optional().openapi({ example: 1 }),
      server: z.string().optional().openapi({ example: 'mirrordub' }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              anime: z.object({
                id: z.string(),
                streamId: z.string(),
                title: z.string(),
                postId: z.number(),
                slug: z.string(),
                url: z.string(),
                mapping: z.object({
                  mapped: z.boolean(),
                  daniId: z.string().nullable(),
                  method: z.enum(['override', 'exact', 'fuzzy', 'none']),
                  confidence: z.number(),
                }),
              }),
              episode: z.object({
                id: z.string(),
                number: z.number(),
                title: z.string(),
                url: z.string(),
                totalEpisodes: z.number(),
              }),
              streams: z.array(streamItemSchema),
            }),
          }),
        },
      },
    },
  },
  description:
    'Retrieve Hindi-dub stream links from DesiDub. Use id from /hindi-dubbed streamId and optional episode/server filters.',
});

export default hindiDubbedStreamSchema;

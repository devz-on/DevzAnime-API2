import { createRoute, z } from '@hono/zod-openapi';

const detailsSchema = createRoute({
  method: 'get',
  path: '/hindi-dubbed/anime/{id}',
  request: {
    params: z.object({
      id: z.string().min(1).openapi({ example: 'desidub-5001-attack-on-titan-season-1' }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            data: z.object({
              title: z.string(),
              alternativeTitle: z.string(),
              id: z.string(),
              streamId: z.string(),
              poster: z.string(),
              episodes: z.object({
                sub: z.number(),
                dub: z.number(),
                eps: z.number(),
              }),
              type: z.string(),
              duration: z.string(),
              synopsis: z.string(),
              source: z.object({
                postId: z.number(),
                slug: z.string(),
                url: z.string(),
              }),
              episodeList: z.array(
                z.object({
                  id: z.string(),
                  episodeNumber: z.number(),
                  title: z.string(),
                  watchUrl: z.string(),
                })
              ),
            }),
          }),
        },
      },
    },
  },
  description:
    'Retrieve Hindi dubbed anime details and watch episodes from DesiDub. Use id from /hindi-dubbed or /hindi-dubbed/search.',
});

export default detailsSchema;

import { createRoute, z } from '@hono/zod-openapi';

const schema = z.object({
  status: z.boolean(),
  data: z.object({
    meta: z.object({
      date: z.date(),
      currentDate: z.date(),
      lastDate: z.date(),
    }),
    response: z.array(
      z.object({
        title: z.string(),
        alternativeTitle: z.string(),
        id: z.string(),
        time: z.string(),
        episode: z.number(),
      })
    ),
  }),
});

export const monthlyScheduleSchema = createRoute({
  method: 'get',
  path: '/schedule',
  request: {
    query: z.object({
      date: z
        .string()
        .optional()
        .openapi({ example: '21', description: 'Day of month (1-31). Defaults to current day.' }),
    }),
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: schema,
        },
      },
    },
  },
  description: 'Retrieve Schedule Anime By Date example: ?date=21. Default is CurrentDate',
});

export default monthlyScheduleSchema;

import { swaggerUI } from '@hono/swagger-ui';
import { Scalar } from '@scalar/hono-api-reference';

export function configureDocs(app) {
  const openApiConfig = {
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Hinaime API',
    },
  };

  app.doc('/openapi.json', openApiConfig);
  app.doc('/api/openapi.json', openApiConfig);

  app.get(
    '/doc',
    Scalar({
      url: '/openapi.json',
    })
  );
  app.get(
    '/api/doc',
    Scalar({
      url: '/api/openapi.json',
    })
  );
  app.get(
    '/scalar',
    Scalar({
      url: '/openapi.json',
    })
  );
  app.get(
    '/api/scalar',
    Scalar({
      url: '/api/openapi.json',
    })
  );
  app.get(
    '/swagger',
    swaggerUI({
      url: '/openapi.json',
    })
  );
  app.get(
    '/api/swagger',
    swaggerUI({
      url: '/api/openapi.json',
    })
  );
}

import app from './src/app.js';
import { serve } from '@hono/node-server';

const port = Number(process.env.PORT) || 3030;

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    const host = typeof info === 'object' && info ? info.address : 'localhost';
    const activePort = typeof info === 'object' && info ? info.port : port;
    console.log(`server is running visit http://${host}:${activePort}/doc for docs`);
  }
);

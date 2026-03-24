import createApp from './lib/create-app.js';
import { configureDocs } from './lib/configure-docs.js';
import router from './routes/routes.js';
import { proxyHandler, proxyOptionsHandler } from './routes/proxy.js';
import monthlyScheduleHandler from './modules/schedule/monthlySchedule/monthlySchedule.handler.js';
import nextEpScheduleHandler from './modules/schedule/nextEpSchedule/nextEpSchedule.handler.js';
import withTryCatch from './utils/withTryCatch.js';

const app = createApp();

configureDocs(app);

app.options('/api/v1/proxy', proxyOptionsHandler);
app.get('/api/v1/proxy', proxyHandler);
app.options('/v1/proxy', proxyOptionsHandler);
app.get('/v1/proxy', proxyHandler);

// Compatibility aliases for clients that expect direct schedule routes.
app.get('/api/v1/schedule', withTryCatch(monthlyScheduleHandler));
app.get('/api/v1/schedule/next/:id', withTryCatch(nextEpScheduleHandler));
app.get('/v1/schedule', withTryCatch(monthlyScheduleHandler));
app.get('/v1/schedule/next/:id', withTryCatch(nextEpScheduleHandler));

app.route('/api/v1', router);
app.route('/v1', router);

export default app;

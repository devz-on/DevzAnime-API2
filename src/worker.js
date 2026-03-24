let app;

export default {
  async fetch(request, env, ctx) {
    globalThis.__APP_RUNTIME_ENV__ = env;

    if (!app) {
      const module = await import('./app.js');
      app = module.default;
    }

    return app.fetch(request, env, ctx);
  },
};

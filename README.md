# DevzAnime-API

Unofficial REST API for scraping anime data from hianime.

## Runtime support

- Node.js (local development)
- Vercel Serverless Functions (free tier)
- Cloudflare Workers (free tier)
- Redis is optional and currently disabled in this branch

## New features

- Error collector worker for upstream and handler failures.
- Error diagnostics endpoint: `GET /api/v1/errors` (also available at `GET /v1/errors`).
- Failure responses now include `details.errorId` when available, so each client error can be traced in collector logs.
- Filterable diagnostics: by source, reason, status code, route text, and time.

## Production requirement (important)

To fully use this API in production, you also need to deploy **AniProx**:

- https://github.com/devz-on/AniProx

`DevzAnime-API` provides anime metadata and stream source discovery, but production-grade playback usually requires a dedicated media proxy layer (for m3u8/segment/caption requests, upstream header handling, and cross-origin compatibility).  
Use AniProx as that proxy layer in front of stream/caption/thumbnail media requests.

## Local setup

```bash
npm install
npm run dev
```

Local URLs:

- API base: `http://localhost:3030/api/v1`
- Docs: `http://localhost:3030/doc`

## Environment variables

Use `.env.example`:

```env
ORIGIN=ani.devxjin.site,anime.devxjin.site,devzanime.vercel.app
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_LIMIT=100
NODEJS_HELPERS=0
PROXY_CACHE_MODE=bandwidth
PROXY_TIMEOUT_MS=10000
PROXY_RETRY_COUNT=1
RESPONSE_CACHE_ENABLED=1
RESPONSE_CACHE_DEFAULT_TTL_SECONDS=240
RESPONSE_CACHE_HOME_TTL_SECONDS=120
RESPONSE_CACHE_SEARCH_TTL_SECONDS=180
RESPONSE_CACHE_STATIC_TTL_SECONDS=420
ERROR_COLLECTOR_ENABLED=1
ERROR_COLLECTOR_MAX_ENTRIES=250
ERROR_COLLECTOR_INCLUDE_STACK=0
ERROR_COLLECTOR_TOKEN=
```

## Error collector guide

### 1) Generate an error token (recommended)

Use one of these:

```bash
openssl rand -hex 32
```

or

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2) Set the token in API environment

```env
ERROR_COLLECTOR_TOKEN=<your-generated-token>
```

If token is set, `/errors` requires header `x-error-collector-token`.  
If token is empty, endpoint is open (not recommended for production).

### 3) Optional frontend integration (DevzAnime)

In `DevzAnime-main/.env`:

```env
VITE_HIANIME_ERROR_TOKEN=<same-token>
```

### 4) Read recent failures

Without token (only if token is disabled):

```bash
curl "https://<host>/v1/errors?limit=25"
```

With token:

```bash
curl "https://<host>/v1/errors?limit=25" \
  -H "x-error-collector-token: <your-generated-token>"
```

Supported query params:

- `limit` (1-200, default 50)
- `source` (`upstream-fetch`, `route-handler`, `app-onerror`, etc)
- `reason` (`http-error`, `network`, `timeout`, etc)
- `statusCode` (e.g. `500`, `429`)
- `route` (substring match against request path/upstream URL)
- `since` (ISO datetime, e.g. `2026-02-14T00:00:00.000Z`)

## Deploy To Cloudflare (easy way)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/devz-on/DevzAnime-Api)

This repo includes `src/worker.js` and `wrangler.toml`.

1. Install dependencies: `npm install`
2. Login: `npx wrangler login`
3. Deploy: `npx wrangler deploy`

Worker URLs:

- API base: `https://<your-worker>.<subdomain>.workers.dev/api/v1`
- Docs: `https://<your-worker>.<subdomain>.workers.dev/doc`

Notes:

- `wrangler.toml` uses `nodejs_compat` for npm compatibility.
- Update CORS/rate-limit and error collector vars in `[vars]` if needed.

## Deploy on Vercel (currently not available)

This repo includes:

- `api/[...route].js` (Vercel Function entry)
- `vercel.json` (runtime + routing settings for serverless functions)

1. Import the repo in Vercel.
2. Set env vars (`ORIGIN`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_LIMIT`, `NODEJS_HELPERS=0`, collector vars).
3. Deploy.

No manual framework preset/build preset tuning is required. Runtime and route behavior are declared in `vercel.json`.

Vercel URLs:

- API base: `https://<your-project>.vercel.app/api/v1`
- Docs: `https://<your-project>.vercel.app/api/doc`
- OpenAPI: `https://<your-project>.vercel.app/api/openapi.json`

## Main endpoints

- `GET /api/v1/home`
- `GET /api/v1/spotlight`
- `GET /api/v1/topten`
- `GET /api/v1/anime/{animeId}`
- `GET /api/v1/search?keyword={query}&page={page}`
- `GET /api/v1/search/suggestion?keyword={query}`
- `GET /api/v1/episodes/{animeId}`
- `GET /api/v1/servers?id={episodeId}`
- `GET /api/v1/stream?id={episodeId}&server={server}&type={sub|dub}`
- `GET /api/v1/errors?limit=25`

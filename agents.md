# AGENTS.md - DAniApi

Update AGENTS.md every time something big is changed, fixed, added, removed, or behavior is altered.

## Purpose
- DAniApi is the anime metadata/content API used by DevzAnime.
- It scrapes and normalizes provider data, exposes REST endpoints, and includes an error collector.
- It now respects global maintenance mode from D-Logger.

## Stack
- Hono + OpenAPI route schemas (`@hono/zod-openapi`)
- Node runtime and Cloudflare Worker compatibility
- Rate limiting middleware
- Provider service layer + extractor modules

## Base Paths
- `/api/v1/*` primary
- `/v1/*` compatibility alias
- Docs/OpenAPI configured via `configure-docs.js`

## High-Level Runtime
1. `src/app.js` creates app, registers proxy + schedule aliases, mounts router.
2. `src/lib/create-app.js` applies CORS, rate limit, logger, error handler.
3. Before serving most API routes, maintenance middleware checks D-Logger status endpoint.
4. If maintenance is enabled, returns `503` (`MAINTENANCE_MODE` details) for normal routes.

## Maintenance Integration
- Source of truth is D-Logger: `GET /api/v1/maintenance/status`.
- Service file: `src/services/maintenanceMode.js`.
- Config:
  - `LOGGER_MAINTENANCE_STATUS_URL` (optional override)
  - `LOGGER_MAINTENANCE_TIMEOUT_MS`
  - `LOGGER_MAINTENANCE_CACHE_MS`
  - `LOGGER_MAINTENANCE_CHECK_ENABLED`
- `/api/v1/errors` and `/v1/errors` are bypassed from maintenance blocking.

## Direct Stream Policy
- `/stream` responses should return direct playable media links when resolved (for example direct `.m3u8`), not pre-wrapped local proxy links.
- Proxy wrapping, if needed for client playback, should be handled by the client/proxy layer (DevzAnime/AniProx), not forced into DAniApi stream link output.
- For `hd-1`/`hd-2` wrapper links (`/stream/mal/...` or `/stream/ani/...`), DAniApi prioritizes episode-bound resolver chains (nine/ajax server+sourcing flow) to avoid mismatched cross-title streams.
- Hianime web fetch flow no longer hard-depends on `/home` bootstrap first; it attempts target watch/ajax requests directly and only initializes session as fallback when needed. This reduces stream latency significantly when `/home` is slow/unstable.

## Endpoint Catalog (module routes)
Mounted under both `/api/v1` and `/v1`:
- `/home`
- `/spotlight`
- `/spotlight-animes`
- `/topten`
- `/top-10-animes`
- `/anime/{id}`
- `/anime/random`
- `/search`
- `/suggestion`
- `/characters/{id}`
- `/character/{id}`
- `/actor/{id}`
- `/genre/{genre}`
- `/az-list/{letter}`
- `/producer/{id}`
- `/filter`
- `/episodes/{id}`
- `/servers/{id}`
- `/stream`
- `/schedule`
- `/schedule/next/{id}`
- `/meta`
- `/errors`
- `/hindi-dubbed`
- `/hindi-dubbed/search`
- `/hindi-dubbed/anime/{id}`
- `/hindi-dubbed/stream`
- `/{query}` (explore catch-all)

Also in `src/app.js`:
- `GET /api/v1/proxy` and `GET /v1/proxy`
- `OPTIONS /api/v1/proxy` and `OPTIONS /v1/proxy`
- Compatibility aliases for schedule:
  - `GET /api/v1/schedule`
  - `GET /api/v1/schedule/next/:id`
  - `GET /v1/schedule`
  - `GET /v1/schedule/next/:id`

Global utility endpoints from app bootstrap:
- `GET /`
- `GET /api`
- `GET /ping`
- `GET /api/ping`

## Interconnections
- DevzAnime frontend uses DAniApi for home/search/details/episodes/servers/stream data.
- D-Logger does auth/session/admin/maintenance control.
- AniProx is used for media proxying where direct playback needs header/CORS rewriting.

## Source-of-Truth for Routes
- OpenAPI schemas in `src/modules/**/**.schema.js`.
- Router assembly in `src/routes/routes.js`.

## AI Editing Notes
- If adding new routes, update:
  - schema file
  - handler
  - module index export
  - router registration if needed
  - this AGENTS.md endpoint catalog
- Keep maintenance bypass scope tight (only required admin/diagnostic routes).

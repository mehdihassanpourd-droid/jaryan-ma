# jaryan-ma admin API (foundation)

A Cloudflare Worker that manages products in D1 and publishes the public catalogue snapshots to R2. **It is not deployed and nothing in CI deploys it.** See [docs/admin/ARCHITECTURE.md](../../docs/admin/ARCHITECTURE.md) for the design and [docs/admin/CLOUDFLARE-SETUP.md](../../docs/admin/CLOUDFLARE-SETUP.md) for the (approval-gated) setup.

## Layout

```
migrations/0001_init.sql   D1 schema
src/index.ts               router: auth -> CSRF -> role check -> handler
src/auth/access.ts         Cloudflare Access JWT verification (WebCrypto, RS256)
src/auth/rbac.ts           roles and actions
src/http.ts                JSON helpers, security headers, Origin check, body limits
src/repository.ts          all SQL (bound parameters only), optimistic concurrency, import, audit
src/publisher.ts           writes public snapshots to R2
src/d1.ts, src/env.ts      structural types for D1/R2 and the Worker environment
test/                      tests run on in-memory SQLite + a fake bucket + real RSA-signed tokens
```

Shared, dependency-light logic (validation, CSV, query building, snapshot format, Persian helpers) lives in [`src/domain`](../../src/domain) so the admin UI in the browser and this Worker use the same code.

## Routes (all under `/api/v1`, all require a verified Access token and an enabled admin)

| Method & path | Right | Notes |
|---|---|---|
| `GET /me` | any admin | email and role |
| `GET/POST /categories` | read / `category:write` | |
| `GET /products` | `product:read` | `q`, `status`, `categoryId`, `fulfillment`, `availability`, `minPrice`, `maxPrice`, `sort`, `page`, `pageSize` (≤ 100) |
| `POST /products` | `product:write` (+ `product:publish` for non-draft) | |
| `GET /products/:id` | `product:read` | full product with images and variants |
| `PUT /products/:id` | `product:write` | body `{ expectedVersion, product }`; `409 version_conflict` if stale |
| `POST /products/:id/status` | `product:publish` | body `{ status, expectedVersion }`; re-validates publish rules |
| `POST /products/:id/images?alt=` | `image:upload` | raw jpeg/png/webp body ≤ 5 MB |
| `POST /products/import[?defer=1]` | `product:import` | `{ products: [...] }`, ≤ `IMPORT_CHUNK_MAX`, all-or-nothing |
| `POST /catalog/resync` | `catalog:sync` | rebuild category shards + manifest |
| `GET /healthz` (outside `/api/v1`) | none | `{ "ok": true }` only |

Errors are JSON `{ "error": "<code>", ... }`: `401 unauthorized`, `403 forbidden | bad_origin`, `409 version_conflict | slug_taken | sku_taken | too_many_images`, `413`, `415`, `422 validation_failed` (with `issues: [{ path, code }]`), `503 admin_not_configured | auth_unavailable`.

## Run the tests

```bash
npm test          # from the repository root; no Cloudflare account or credentials needed
```

The D1 shim uses Node's built-in `node:sqlite` (Node ≥ 22.13), the same SQL engine as D1, and applies the real migration file.

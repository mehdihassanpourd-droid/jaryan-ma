# Admin PWA (جریان ما · مدیریت)

A mobile-first, Persian RTL web app for managing products from an Android phone (or a desktop browser). It is an installable PWA that talks to the **existing** admin API; there is no new backend.

## What it is, and what it is not

- A React 19 single-page app in `admin/`, built with esbuild to `dist/admin/` (`npm run admin:build`) and served **by the existing Node API server at `/admin/`** — same origin as `/api/v1`, which is what lets the session cookie stay `HttpOnly` + `SameSite=Strict` and the CSRF token live in memory only.
- **Not** part of the public static site. `.github/workflows/cloudflare-pages.yml` and `next.config.ts` are untouched; `server/invariants.test.ts` fails if the storefront imports `admin/` or the deploy workflow starts referencing it.
- `server/admin-ui.ts` is a small static-file handler (GET/HEAD, extension allow-list, no traversal, symlink-safe) plus security headers. It adds no endpoint that touches data.
- Checkout, payments and customer-facing features are out of scope.

## Running it

```bash
npm run admin:build                 # build the app into dist/admin
DEV_ADMIN_EMAIL=you@example.test DEV_ADMIN_PASSWORD='a long throw-away password' npm run api:dev
# open http://127.0.0.1:3001/admin/
```

- Development uses the embedded PostgreSQL and local disk media — no production server, cloud account or paid service.
- `DEV_ADMIN_*` creates a development-only owner **without** 2FA and is refused in production. To exercise mandatory TOTP locally, create accounts with `npm run admin -- create --email … --role owner` and run with `REQUIRE_TOTP=true` (this is what the E2E tests do).
- `npm run admin:dev` rebuilds on change. Env: `ADMIN_UI_DIR` (default `dist/admin`), `ADMIN_UI_ENABLED=false` to switch the UI off.
- **From an Android phone with no PC:** a free, throw-away GitHub Codespaces setup (Node 22 + PostgreSQL 16, private forwarded port, mandatory TOTP) is described in [CODESPACES-FA.md](CODESPACES-FA.md); CI verifies its scripts on Ubuntu 24.04 (`codespace-env.yml`). The bare server address (`/`) redirects to `/admin/`; if `dist/admin` has not been built the server answers 503 with an explanation (never a silent 404) and `npm run api:dev` builds it once. **Codespaces self-update:** `up.sh` (every Codespace start) and a background `watch.sh` (every 15 min) run `update.sh`: a fast-forward-only update to `origin/main` that refuses on local edits or unmerged commits, never resets, cleans or deletes anything (`.data/` is git-ignored, so the database, accounts and uploads survive), runs `npm ci` only when package files changed, `prisma migrate deploy` only when migrations changed, rebuilds the admin only when `admin/` changed, and restarts the app on the new code. No token or secret is needed (the Codespace already has access to its own repository). The running commit is shown on the sign-in page in development. **Embedded development database:** PGlite is a single PostgreSQL session, so the server (and the test suite) connect to it with ONE pool connection (`EMBEDDED_POOL`). With several, overlapping transactions collided (Prisma P2039) and produced random HTTP 500s; `server/embedded-concurrency.test.ts` reproduces that against the real runtime. Real PostgreSQL (production, the Codespaces setup) is unaffected and keeps its normal pool. **GitHub's forwarder rewrites Origin and Host (Codespaces):** the browser is on `https://<codespace>-3001.app.github.dev`, but the request that reaches the server carries `Origin: http://localhost:3001` and `Host: localhost:3001` (reported by users: [community discussion 147513](https://github.com/orgs/community/discussions/147513), and confirmed by the on-screen diagnostics). The external name never arrives, so an exact allow-list match can never succeed. In development only, `ADMIN_ACCEPT_REWRITTEN_ORIGIN=true` (set by `start.sh`, **refused in production**) therefore accepts exactly the loopback origin of the server's OWN port (`http://localhost:3001`, `127.0.0.1`, `[::1]`; no other port, host or scheme) when the `Host` header says the same, and refuses it if the browser sent a `Referer` that is not the Codespace's own page. What remains after that is honest to state: a hostile page that strips its own Referer cannot be told apart at the Origin layer, so the other layers carry it: the session cookie is `SameSite=Strict`, signed-in changes need the CSRF token, the forwarded port sits behind GitHub's login, sign-in needs password + TOTP, and the anonymous first-admin endpoints cannot be completed cross-site (their responses are unreadable there and finishing needs the returned secret). Production keeps the exact allow-list only. The admin app itself never uses an absolute or localhost API URL (`/api/v1` is relative). **Forwarded HTTPS hosts (Codespaces):** behind GitHub's forwarder the browser's `Origin` is the external `https://<codespace>-3001.app.github.dev` host. Besides the exact `ADMIN_ORIGINS` string, a development server (`ADMIN_ORIGIN_HOST_SUFFIXES=.app.github.dev`, set by `start.sh`, **refused in production**) accepts an https Origin that is exactly the host the request was addressed to and ends with that suffix. That is the definition of same-origin, so other sites and other Codespaces are still refused; CSRF tokens remain mandatory. A refused origin is explained in the response and on screen in development only. **First-run setup** (`FIRST_RUN_SETUP=true`, development only, refused by the production configuration) lets the browser create the FIRST administrator: strong password plus a mandatory TOTP that must be proven with a current code before anything is stored; it closes permanently once any account exists and cannot reset passwords or TOTP.
- In production the same server serves `/admin/` behind your TLS reverse proxy (see SELF-HOSTING.md). Add the admin origin to `ADMIN_ORIGINS`.

## Features

| Area | Behaviour |
|---|---|
| Sign-in | Email + password + **mandatory 6-digit TOTP** through the existing `/auth/login`; Persian errors, rate-limit messages, expired-session notice. No sign-up, no default account, no bypass. |
| Roles | The session returns the role's permission list; the UI hides what the role cannot do (viewer: read-only; editor: catalogue; owner: all). **The server remains authoritative** (tested: a forged write by a viewer returns 403). |
| Products | Search (debounced), filters (status, category, fulfilment, stock), sort, pagination; state lives in the URL hash. Create, edit, **duplicate** (draft copy, new SKUs), **archive/restore**, quick publish/unpublish. |
| Variants & stock | Up to 3 option names, per-variant SKU / price / stock; unique, stocked and made-to-order rules come from the shared domain validation. |
| Prices | Entered as text (Persian digits and separators accepted), parsed with BigInt-exact rules up to 10¹⁵ Toman; decimals, exponents and over-limit values are rejected, never rounded. |
| Images | Camera (`capture=environment`) and gallery pickers; images are decoded with EXIF orientation, scaled to ≤ 2000 px and re-encoded (WebP/JPEG, < 4.5 MB) in the browser, then uploaded to `POST /products/:id/images`. Reorder, alt text, remove. A product must be saved once as a draft before images can be attached. |
| Workflow | Draft → (approximate phone preview) → publish; publish needs category, ≥ 1 image and a price (validated locally and by the server). Optimistic-concurrency conflicts (HTTP 409) are explained and offer a reload. |
| SEO | Editable SEO title (≤ 70) and description (≤ 160) per product and per-image alt text. **Suggestions are produced by the same `src/seo` code the storefront build uses** (nothing invented), with a SERP preview and advisory hints. Empty = automatic. |
| CSV | Export (all statuses, with variants and SEO fields, UTF-8 BOM, formula-injection protected) and import (validated in the browser with Persian row/column messages; nothing is sent while errors exist; chunked upload with progress; one category-file rebuild at the end). Format: CSV-FORMAT.md. |
| Categories | List and create. |
| Account | Change password, sign out, install button, note on how 2FA is (re)enrolled (server CLI only). |

SEO safeguards are preserved: sample (`isDemo`) content and the pre-launch closed mode are unchanged; the new fields only feed the existing generator and are subject to the same length limits (DB `CHECK` constraints + zod).

## Backend changes in this PR

- `Product.seoTitle` / `seoDescription` (nullable; migration `20261029000000_product_seo_fields`, additive, checked for drift). `undefined` means "keep", `null`/empty means "clear" — also in CSV (columns appended at the end so older files keep working).
- `GET /auth/session` and the login response now include `permissions` and `mediaBaseUrl`.
- `server/admin-ui.ts` serves the built app (see above).

## Security model

- Cookie: `HttpOnly`, `SameSite=Strict`, `Secure` in production. CSRF token in memory only (never in storage); Origin allow-list (`ADMIN_ORIGINS`) on every mutation — all pre-existing.
- Strict CSP on `/admin/`: `default-src 'none'`, scripts/styles/fonts from `'self'` only, **no `unsafe-inline`/`unsafe-eval`**, `connect-src 'self'`, images from `'self'`, `blob:` and the media origin. Also `frame-ancestors 'none'`, `nosniff`, `no-referrer`, COOP/CORP. The app has no inline styles, no `innerHTML`, no `eval` (guarded by `server/invariants.test.ts`).
- Offline: the service worker precaches **only** the app shell (HTML, hashed JS/CSS, fonts, icons) under `/admin/`. It never intercepts `/api/` or media, so no product, session or personal data is cached; signing out leaves nothing to clear. The browser tests assert the cache contents and that `localStorage`/`sessionStorage`/IndexedDB/`document.cookie` are empty.
- Image keys are only turned into URLs when they match the server's key pattern.
- The page is `noindex`; `/admin/` is not in the sitemap.

## Tests

- Unit (`npm test`, included in `npm run check`): money/BigInt edge cases, form↔API conversion and validation, duplicate rules, image helpers, router, API client, SEO suggestions, CSV helpers, admin static server (traversal, symlinks, headers), architecture guards.
- Browser end-to-end (`npm run admin:e2e`, Playwright + Chromium, CI job "Admin PWA"): boots the **real server** (embedded PostgreSQL, local media, `REQUIRE_TOTP=true`, accounts with real TOTP secrets) and drives the built app: TOTP login (wrong code rejected), category/product creation, upload through a real file input, image reorder, SEO fields, publish and BigInt-exact price round-trip, list/search, duplicate, archive, CSV export/import with a bad file, RBAC (viewer/editor, forged request refused), sign-out, service-worker cache and storage contents, CSP/console errors, **no horizontal overflow at 390 px**, **axe-core WCAG 2 A/AA with zero violations** on every screen and editor tab (and at 1280 px).

## What is real, what is mocked, what needs production infrastructure

- **Real end to end** (verified by the browser tests above): login with TOTP, sessions/CSRF, RBAC, product CRUD, variants, images (client-side resize → upload → storage), SEO fields, publish workflow, CSV, categories.
- **Mocked / simulated:** nothing in the app or the tests mocks authentication or the API. Development storage is local disk and PostgreSQL is embedded (PGlite) or a local server — the same code paths as production, different adapters. The phone preview is an approximation drawn by the admin, not the storefront.
- **Not verifiable without production infrastructure:** installability prompt and service worker behaviour over real HTTPS on an Android device (they require a secure context; tested on `127.0.0.1`/localhost only), camera capture on a physical phone (the `capture` attribute is exercised as a file input, not a real camera), TLS/reverse-proxy headers, S3-compatible media storage and `PUBLIC_MEDIA_URL` (CSP allows the configured media origin), a real PostgreSQL/PgBouncer at scale, and the storefront rebuild after publishing (the admin only triggers the existing snapshot publisher; building/deploying the static site is unchanged).
- Implemented but **not** covered by browser tests: password change, the install button (`beforeinstallprompt`), the category parent selector, the 409 conflict banner (the server-side conflict is tested separately).
- Known limits: images removed in the editor stay in object storage (no garbage collection yet); an unsaved new product cannot take images until saved as a draft; the unsaved-changes guard covers closing the tab and "back to list" but not every hash navigation; Persian digits are shown with `toLocaleString("fa-IR")`.

## Product workflow test (real PostgreSQL, phone viewport)
`admin/e2e/product-workflow.e2e.ts` drives the real admin UI on a 412×915 touch viewport: first administrator + TOTP, category, draft, real image upload (a large PNG the browser shrinks and re-encodes), price and stock, publish, edit of the published product, reload, variants (including a duplicate-SKU refusal). With `E2E_DATABASE_URL` (a migrated, EMPTY PostgreSQL) it runs on that database and checks the stored row; CI runs it on PostgreSQL 16. `E2E_SHOTS=<dir>` also saves full-page screenshots. Messages from a failed save are cleared as soon as the form is edited, so a fixed form never keeps a stale red banner.

## Orders
`#/orders` lists the orders customers placed (open orders first, pending on top and highlighted; status filter; paging). `#/orders/<number>` shows one: items with variant/SKU/quantity/unit price and how many units are reserved, the exact total (shipping not included), recipient, phone, address, note, the customer and the **status history** (who, when, why). With `order:manage` (owner, support) it offers the allowed next steps: confirm, reject, cancel (with an optional reason shown to the customer), start preparing, ship, deliver; cancelling or rejecting gives the reserved stock back automatically. A change made from a stale screen is refused and the screen reloads the real state. Editors and viewers see no orders (personal data). Orders waiting for a decision are announced everywhere: banner, nav badge, page title and a toast when a new one arrives (polled every 30 s from this same server while the page is visible; nothing foreign). Details and the rules: [CUSTOMERS.md §9](../customers/CUSTOMERS.md). API: `GET /api/v1/orders`, `/orders/summary`, `/orders/:number`, `POST /orders/:number/transition`. Browser tests: `admin/e2e/shopping.e2e.ts`, `admin/e2e/order-management.e2e.ts`.

## Shipping («ارسال»)

Owner-only screen to switch delivery methods on, set prices by destination and weight, free-shipping thresholds, delivery days and the default item weight. The order screen shows the fee breakdown and lets staff enter the carrier and tracking code (with «ثبت ارسال» or later). Product editor: «وزن یک عدد (گرم)». See `docs/shipping/SHIPPING.md`.

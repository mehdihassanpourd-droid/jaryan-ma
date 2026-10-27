# جریان ما (Jaryan Ma)

> اینجا هنر در جریان است

Online store and gallery for Iranian handmade art. Persian (RTL), Toman currency, single-vendor today and structured for a future multi-vendor marketplace. Instagram: [@jaryan.ma](https://instagram.com/jaryan.ma)

**Status:** foundation phase. The homepage is built; all products, categories and images are **demo content**. Payments are not implemented.

Docs: [PRD.md](PRD.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [CLAUDE.md](CLAUDE.md)

## Requirements
- Node.js ≥ 20.9 (developed on 22)
- npm
- PostgreSQL 14+ (only needed once you work on database-backed features)

## Getting started
```bash
npm install
cp .env.example .env      # then edit DATABASE_URL (never commit .env)
npm run db:generate       # generate the Prisma client
npm run dev               # http://localhost:3000
```
The homepage currently renders from `src/data/demo-catalog.ts` and does not need a database.

### Database (optional for now)
```bash
createdb jaryan_ma
npm run db:migrate        # creates and applies the first migration
npm run db:studio
```

## Scripts
| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build (static export to `out/`) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript |
| `npm test` | Vitest |
| `npm run db:validate` | Validate Prisma schema |
| `npm run db:generate` | Generate the Prisma client (runs automatically before test/typecheck/build) |
| `npm run api:dev` / `api:build` / `api:start` | Admin API: dev server / bundle / run the bundle |
| `npm run admin:build` / `admin:dev` / `admin:e2e` | Build the admin PWA into `dist/admin` (served at `/admin/` by the API server) / rebuild on change / browser tests against the real server (Chromium) |
| `npm run admin -- <command>` | Administrator CLI (see docs/admin/SELF-HOSTING.md) |
| `npm run ops -- <command>` | Operations CLI: health, security-check, backup, restore-test, backup-status, log-action (see docs/maintenance/MAINTENANCE.md) |
| `npm run check` | lint + typecheck + test + schema validation |

## Automated deployment (GitHub Actions)
`.github/workflows/cloudflare-pages.yml` checks, builds and deploys the static export to the Cloudflare Pages project **`jaryan-ma`** without the Cloudflare Git integration:

| Event | What runs |
|---|---|
| Pull request to `main` | `npm run check`, `npm run build`, then a **preview** deployment at `https://pr-<number>.jaryan-ma.pages.dev` (the exact URL is in the run's summary) |
| Push / merge to `main` | `npm run check`, `npm run build`, then a **production** deployment |
| PR from a fork | checks and build only (forks cannot read secrets) |

Deployment is skipped (with a notice, not a failure) until both repository secrets exist. Nothing is deployed from an unconfigured repo.

### One-time activation
1. **Cloudflare project.** The project `jaryan-ma` must be a *Direct Upload* project with production branch `main`. Create it once from any machine with a token (or in the dashboard: Workers & Pages → Create → Pages → Upload assets): `npx wrangler pages project create jaryan-ma --production-branch main`. A project created through "Connect to Git" cannot receive Wrangler deployments.
2. **API token.** Cloudflare dashboard → My Profile → API Tokens → Create Custom Token. Permission: **Account → Cloudflare Pages → Edit**, scoped to your account only.
3. **Account ID.** Shown under Workers & Pages in the dashboard sidebar.
4. **GitHub secrets.** Repository → Settings → Secrets and variables → Actions → **New repository secret**, add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Enter them only in that GitHub form; never in chat, issues, commits or workflow files.
5. **(Optional) public site URL.** Same page, **Variables** tab: `NEXT_PUBLIC_SITE_URL` = e.g. `https://jaryan-ma.pages.dev`. It is public and used only for page metadata.
6. **Run it.** Re-run the latest workflow (Actions → Cloudflare Pages → Re-run all jobs) or open/merge a PR. The deployment URL appears in the run summary.

Notes: third-party actions are pinned to commit SHAs. Credentials are passed only to the Cloudflare deploy step, and GitHub masks secret values in logs. Rotate the token under My Profile → API Tokens if it is ever exposed. Pull requests are never merged automatically.

## Deploying the static demo to Cloudflare Pages
(The GitHub Actions flow above is the recommended route; the options below are alternatives.)

The demo is a fully static export (`output: "export"` in `next.config.ts`). It has no server, database or secrets.

**Dashboard (Git integration):**
1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pick `jaryan-ma`.
2. Settings:

   | Setting | Value |
   |---|---|
   | Production branch | `main` |
   | Framework preset | None (or Next.js (Static HTML Export)) |
   | Build command | `npm run build` |
   | Build output directory | `out` |
   | Root directory | _(leave empty)_ |

3. Environment variables (optional): `NEXT_PUBLIC_ORDER_API_URL` = the public https base URL of the customer API (optional; without it the checkout is a labelled demo that places no order), `NEXT_PUBLIC_CATALOG_URL` = the public https base URL of the published-catalogue snapshots (set as a repository **variable**; with it the storefront shows real published products live, with no redeploy per publish; see docs/admin/ARCHITECTURE.md §7), `NEXT_PUBLIC_SITE_URL` = your final public URL, e.g. `https://jaryan-ma.pages.dev` (used for metadata only). It is **public** and inlined into the build, so never put secrets in `NEXT_PUBLIC_*` variables. Do not set `DATABASE_URL`; the demo does not use a database.
4. Node version is pinned by `.node-version` (22). Save and deploy.

**Manual deploy** (no Git integration): `npm run build`, then `npx wrangler pages deploy out --project-name jaryan-ma`.

**Preview locally:** `npm run build && npx serve out`.

Files that configure the deployment:
- `public/_headers` — security headers and long-lived caching for hashed assets.
- `public/robots.txt` — currently `Disallow: /` so the demo isn't indexed. Remove or relax it when real content launches.
- `out/404.html` is generated from `src/app/not-found.tsx`; Cloudflare Pages serves it automatically for unknown URLs.

### Static export limitations
While `output: "export"` is enabled, these Next.js features cannot be used (the build fails or they silently don't work). Nothing in the current demo uses them:
- Route handlers (`route.ts`), middleware/proxy, server actions, and `headers()`/`cookies()`/dynamic APIs
- ISR/`revalidate`, on-demand revalidation, and dynamic routes without `generateStaticParams`
- `next/image` optimisation (`images.unoptimized` is set; use pre-optimised files) and runtime rewrites/redirects/`headers()` in `next.config.ts` (use `public/_headers` and `public/_redirects`)
- Any use of Prisma/PostgreSQL at request time. Prisma is installed for later phases but is not imported by the app.

Planned features that will need a server runtime (the Node.js admin API in `server/`, or a Node host for the storefront) — see [ARCHITECTURE.md](ARCHITECTURE.md): database-backed catalogue, phone/OTP login, cart and orders, admin panel, payments, and vendor dashboards. Remove `output: "export"` when starting Phase 1/2.

## Admin & product management (foundation)
A self-hostable admin API for managing hundreds or thousands of products from an Android phone: Node.js + **PostgreSQL (Prisma)** + **S3-compatible** image storage, with built-in authentication (password + TOTP, server-side sessions). It is designed to run on a server in Iran, has **no dependency on any cloud service**, and is **not deployed** yet. The public storefront and its Cloudflare Pages deployment are unchanged.

- Design, decisions, security, costs, remaining questions: [docs/admin/ARCHITECTURE.md](docs/admin/ARCHITECTURE.md)
- Running it on your own server: [docs/admin/SELF-HOSTING.md](docs/admin/SELF-HOSTING.md)
- CSV import/export format: [docs/admin/CSV-FORMAT.md](docs/admin/CSV-FORMAT.md)
- **Test the Admin PWA from an Android phone for free (GitHub Codespaces, no PC, no terminal):** [راهنمای فارسی](docs/admin/CODESPACES-FA.md) — [Open in Codespaces](https://codespaces.new/mehdihassanpourd-droid/jaryan-ma). The app starts by itself on a private port; the first administrator is created in the browser (password + mandatory TOTP); throw-away data
- **Admin PWA** (mobile-first Persian RTL app for product management, installable, TOTP login, RBAC, camera/gallery uploads, SEO fields, CSV): [docs/admin/ADMIN-APP.md](docs/admin/ADMIN-APP.md) — served by the API server at `/admin/`, never deployed with the static site
- Customer accounts (phone + SMS code, addresses, favourites, orders, export/deletion): [docs/customers/CUSTOMERS.md](docs/customers/CUSTOMERS.md) — **off in production until an SMS gateway is chosen; no paid service is active**
- Customer support (tickets, notes, roles, abuse protection, Persian FAQ): [docs/support/SUPPORT.md](docs/support/SUPPORT.md)
- Technical maintenance (health, incidents, security checks, error reports, encrypted backups with a verified restore test, free GitHub Actions monitoring): [docs/maintenance/MAINTENANCE.md](docs/maintenance/MAINTENANCE.md)
- Automated SEO (metadata, canonical URLs, Product/Breadcrumb JSON-LD, sitemap, Persian URLs; closed to search engines until launch): [docs/seo/SEO.md](docs/seo/SEO.md) — verify with `npm run seo:verify`
- Prices are exact integer Toman up to 10¹⁵ (PostgreSQL `BIGINT`): [price model](docs/admin/ARCHITECTURE.md#price-model-bigint-reviewed)

The server-side code (`server/`) is never part of the static site; `npm run check` includes tests that fail if storefront code imports it. To also run the server tests against a real PostgreSQL: `TEST_DATABASE_URL=postgresql://user:pw@127.0.0.1:5432/db npm test` (each test file gets its own throw-away schema).

```bash
npm test               # 224 tests on an embedded PostgreSQL: no database, cloud account or credentials needed
npm run api:dev        # admin API on http://127.0.0.1:3001 (embedded PostgreSQL in .data/, local media storage)
npm run admin -- list  # administrator management CLI (create / reset-password / reset-totp / disable)
```

## Project structure
See [ARCHITECTURE.md](ARCHITECTURE.md#2-layout).

## Contributing
Branch from the default branch, run `npm run check && npm run build`, open a PR. Follow the rules in [CLAUDE.md](CLAUDE.md).

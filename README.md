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
| `npm run check` | lint + typecheck + test + schema validation |

## Deploying the static demo to Cloudflare Pages
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

3. Environment variables (optional): `NEXT_PUBLIC_SITE_URL` = your final public URL, e.g. `https://jaryan-ma.pages.dev` (used for metadata only). It is **public** and inlined into the build, so never put secrets in `NEXT_PUBLIC_*` variables. Do not set `DATABASE_URL`; the demo does not use a database.
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

Planned features that will need a server runtime (a Cloudflare Workers/`@opennextjs/cloudflare` deployment or a Node host) — see [ARCHITECTURE.md](ARCHITECTURE.md): database-backed catalogue, phone/OTP login, cart and orders, admin panel, payments, and vendor dashboards. Remove `output: "export"` when starting Phase 1/2.

## Project structure
See [ARCHITECTURE.md](ARCHITECTURE.md#2-layout).

## Contributing
Branch from the default branch, run `npm run check && npm run build`, open a PR. Follow the rules in [CLAUDE.md](CLAUDE.md).

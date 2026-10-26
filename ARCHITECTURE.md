# Architecture — جریان ما

## 1. Stack
| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript strict | Server Components by default |
| Styling | Tailwind CSS v4, tokens in `src/app/globals.css` (`@theme`) | Logical properties for RTL |
| Font | Vazirmatn Variable via `@fontsource-variable` | Self-hosted; no CDN dependency |
| Database | PostgreSQL | Connection via `DATABASE_URL` |
| ORM | Prisma 7 (`prisma-client` generator → `src/generated/prisma`) | Connection URL in `prisma.config.ts`; Prisma 7 needs a driver adapter (`@prisma/adapter-pg`) at runtime — to be added with the first DB-backed page |
| Tests | Vitest | Unit tests colocated as `*.test.ts` |
| Lint | ESLint 9 + `eslint-config-next` | |

## 2. Layout
```
prisma/schema.prisma      data model (multi-vendor ready)
prisma.config.ts          Prisma CLI config
src/app/                  routes, layout, globals.css
src/components/ui/        generic primitives (Button, Badge, Container, Price, SectionHeading)
src/components/layout/    Header, Footer, MobileNav, DemoBanner
src/components/product/   ProductCard, ProductGallery, ArtPlaceholder
src/components/home/      homepage sections
src/data/                 DEMO content only (demo-catalog.ts)
src/lib/                  site config, formatting helpers
src/types/                UI-facing types mirroring Prisma models
```
Dependency direction: `app → components/home → components/{product,ui} → lib/types`. `data/` is replaced by repository functions (below) later; components never import Prisma directly.

## 3. Rendering & data access
- Pages are Server Components. Only interactivity (`MobileNav`, `ProductGallery`) is `"use client"`.
- Today homepage reads `src/data/demo-catalog.ts`. Next step: introduce `src/server/catalog/*.ts` repository functions (`listFeaturedProducts`, `getProductBySlug`, …) returning the `CatalogProduct` types; swap the demo import for those without touching components.
- Catalogue pages: static generation with revalidation (ISR); cart/orders/account: dynamic.

## 4. Multi-vendor readiness
- `Vendor` is first-class. Every `Product` has `vendorId`; every `OrderItem` stores `vendorId` so an order can later split across vendors for fulfilment and payouts.
- Single-vendor phase = exactly one `Vendor` with `kind = PLATFORM`. Marketplace phase adds `INDEPENDENT` vendors with `PENDING → ACTIVE` approval; `VendorMember` links staff users.
- Authorization rules are written as `can(user, action, resource)` helpers (to be added) so vendor-scoping is one place, not scattered `if`s.
- Routes reserved for later: `/vendors/[slug]`, `/dashboard` (vendor), `/admin`.
- Not yet modelled on purpose: commissions, payouts, payments.

## 5. Money
Prices are integer Toman (`Int`), never floats. `null` means "not announced". Display only via `formatToman`. When payments arrive, add a `Payment` model keyed to `Order`; never store card data.

## 6. Security & config
- Secrets only via environment variables; `.env*` is git-ignored, `.env.example` holds placeholders.
- Validate all input server-side (planned: zod) ; auth by phone OTP with rate limiting (Phase 2); role checks on every server action/route handler.
- Baseline security headers ship in `public/_headers` (Cloudflare Pages); add a CSP before launch.

## 7. Quality gates
`npm run check` (lint, typecheck, tests, `prisma validate`) plus `npm run build`. The Cloudflare Pages workflow runs the same on every PR and push to `main`.

## 8. Deployment
**Current demo:** static export (`output: "export"`) hosted on Cloudflare Pages (build `npm run build`, output `out`); deployed by GitHub Actions (`.github/workflows/cloudflare-pages.yml`: checks, build, production on `main`, previews on PRs); see README. Server features are unavailable in this mode and `output: "export"` must be removed before Phase 1 DB-backed pages (and `ISR` in section 3) can work.

**Target (proposed):**
Node 20+ host (container or Node PaaS) + managed PostgreSQL; object storage + CDN for images. Region choice depends on payment/SMS providers **[TBC]**.

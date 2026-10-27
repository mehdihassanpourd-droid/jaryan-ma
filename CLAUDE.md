# CLAUDE.md — development rules for جریان ما

Read `PRD.md` and `ARCHITECTURE.md` first.

## Commands
- `npm run dev` — dev server · `npm run build` — production build
- `npm run check` — lint + typecheck + tests + `prisma validate` (run before every commit)
- `npm run db:generate` — regenerate Prisma client after schema edits (runs automatically before test/typecheck/build)
- `npm run admin:build` — build the admin PWA (`admin/` → `dist/admin`, served at `/admin/` by the API server) · `npm run admin:e2e` — Playwright browser tests against the real server (not part of `check`; CI job "Admin PWA")
- `npm run codespace:setup|up|down|admin|start|logs` — free Android-phone test environment in GitHub Codespaces (`.devcontainer`, `scripts/codespace/`, guide `docs/admin/CODESPACES-FA.md`): the app starts by itself on a private port; first administrator is created in the browser (`FIRST_RUN_SETUP`, dev-only, refused in production); real password + TOTP, throw-away data · `npm run api:dev` builds the admin app once if `dist/admin` is missing
- `npm run ops -- health|security-check|backup|restore-test|backup-status` — operations CLI (see docs/maintenance/MAINTENANCE.md)
- `npm run api:dev` — admin API with embedded PostgreSQL · `TEST_DATABASE_URL=postgresql://… npm test` — run tests on a real PostgreSQL

## Hard rules
1. **No secrets in git.** Never commit `.env*` (except `.env.example` with placeholders), keys, tokens, or DB URLs with real credentials.
2. **No payment processing** until explicitly scheduled (PRD Phase 3).
3. **No invented business facts:** no real prices, artist names/bios, testimonials or statistics. Unknown prices are `null`.
4. **Demo content is labelled.** Sample data lives only in `src/data/` with `isDemo: true` and a visible "نمونه" badge. Remove the banner/badges only when real data replaces it.
   - **Real vs placeholder:** the only confirmed business facts are the brand name, slogan and Instagram account, kept in `src/lib/site.ts`. Real info uses plain styling (`InfoPanel`); anything unconfirmed uses `PlaceholderPanel`/`PlaceholderTag` (dashed border + "نمونه"). Unknown contact details stay `null` in `site.contact`; never invent phone numbers, addresses, prices, reviews, ratings, or shipping/return/guarantee promises.
5. **Keep multi-vendor readiness:** new product/order code must carry `vendorId`; don't hard-code a single seller.
6. **Static demo:** `output: "export"` is on. Do not add route handlers, middleware, server actions, dynamic APIs, `next/image` optimisation or DB access until the export is deliberately removed (see README "Static export limitations").
7. **Admin code stays private and portable.** `server/` is never deployed by the Pages workflow, and no admin function, credential or database access may be added to the public site. Never create a root `functions/` directory (Wrangler would bundle it into the Pages deploy). Application code depends on the ports (`CatalogRepository`, `AdminStore`, `ObjectStorage`, `Authenticator`), not on a vendor: do not import Cloudflare/AWS/vendor SDKs outside the adapter files. Authentication is built in (scrypt + mandatory TOTP + server-side sessions); never add default accounts, mock logins or "dev bypass" flags to production paths.
8. **No paid or new cloud service, and no AI API.** Do not create or enable cloud resources, paid plans or AI-API features without the owner's explicit approval; the project has no cloud budget and only a Claude Pro subscription. Everything must run and be testable locally (embedded PostgreSQL, local disk, in-memory fakes).
9. **Customer authentication is real or absent.** Customers sign in only with an SMS one-time code through the `SmsProvider` port. No paid SMS service is activated by default; `console` SMS is development-only and refused in production; never add test codes, bypass flags or fake sessions to production paths. Customer sign-in stays off in production (`CUSTOMER_ACCOUNTS_ENABLED`) until a gateway is configured.
    - **Shopping:** the storefront cart holds only product/variant/quantity (never prices); the server prices every order from the database and never trusts totals from the browser. Placing an order creates a PENDING order that RESERVES its stock atomically (`server/orders/stock.ts`: `UPDATE … WHERE inventory >= q` in the order's own transaction) and no payment; rejecting/cancelling gives it back exactly once. Never read-then-write stock; order status changes go through `OrderLifecycleService` (state machine in `src/domain/customer/order-status.ts`, history + audit in the same transaction). A build without an order system must keep the checkout a labelled demo that creates no order and shows no order number. The storefront calls only `/api/v1/customer` (from `src/lib/order-api.ts`), never an admin route.
10. **Backups are "operational" only after a successful restore test.** Never write code, docs or PR text that calls backups working because a job ran; the state comes from `assessBackups` (`src/domain/maintenance/backup.ts`).
11. **Personal data is minimal and deletable.** New personal fields must be covered by data export (`gatherExport`) and by `anonymize`; never log phone numbers, codes, tokens, message text or request bodies; internal staff notes live in `SupportNote` and are never selected by customer-facing queries.
12. **SEO is derived from verified data only.** Titles, descriptions, alt text and JSON-LD come from the published catalogue snapshot (`src/seo/`), never from invented text: no ratings, reviews, brand, dates or prices that are not in the data. Sample (`isDemo`) content is never indexable or described as real. Raw HTML injection is allowed only in `src/seo/JsonLd.tsx`. Keep `npm run seo:verify` passing when touching pages, metadata or the snapshot format.
13. **Admin PWA (`admin/`) is browser code that talks only to `/api/v1`.** No imports of `server/`, Prisma or `node:*`; no web storage, cookies from JS, inline styles, `innerHTML` or `eval` (strict CSP, enforced by `server/invariants.test.ts`); the service worker caches the app shell only, never API or media; no mock logins. UI hides what a role cannot do, but the server stays authoritative. Prices are parsed as text with BigInt-exact rules (`admin/src/lib/money.ts`). Docs: `docs/admin/ADMIN-APP.md`.
15. **No mandatory foreign runtime dependency.** The production store must keep working inside Iran during international internet shutdowns: the storefront and the admin may not load or call anything on a foreign host at run time (fonts, CDNs, analytics, scripts, third-party APIs, push services); everything is bundled or served by our own origin, and polling asks our own server. `server/invariants.test.ts` and `admin/e2e/order-management.e2e.ts` enforce it. (The current Cloudflare Pages demo deployment and GitHub-based tooling are build/hosting conveniences, not runtime dependencies of the code.)
14. Work on feature branches; open PRs; never push to the default branch directly.

## Code conventions
- TypeScript strict; no `any`; prefer Server Components, add `"use client"` only for interactivity.
- Components: one per file, PascalCase, named exports, props typed inline or via `interface`. Generic primitives in `components/ui`, domain parts in `components/<domain>`.
- Components never import Prisma; go through `src/server/*` repositories (once present).
- Money: integer Toman. DB columns are `BIGINT`; app values are `number` within `0…MAX_TOMAN` (10¹⁵, exact in JSON) from `src/domain/money.ts`; convert only at the repository boundary (`tomanToDb`/`tomanFromDb`); compute order totals with `lineTotal`/`sumToman` (BigInt); never put a `BigInt` into JSON. Format with `formatToman`/`formatNumber`.
- Add or update a Vitest test for any non-trivial logic in `src/lib`, `src/domain` or `server/`. `server/invariants.test.ts` guards the architecture (storefront never imports `server/`, no tracked secrets, pinned workflows): keep it green.
- Schema changes need a migration in `prisma/migrations` (generate, review, and check `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` against a migrated database).

## UI / RTL / Persian
- Pages are `lang="fa" dir="rtl"`. Use logical utilities (`ms-/me-/ps-/pe-/start-/end-/text-start`), never `left/right/ml/mr` for layout direction.
- Wrap LTR strings (handles, URLs, SKUs) with `dir="ltr"`.
- Colours only from theme tokens (`ivory`, `sand`, `bark`, `olive`); don't hard-code hex in components (the SVG placeholder palette is the one exception).
- Mobile-first: write base styles for phones, then `sm:`/`md:`/`lg:`.
- Accessibility: semantic landmarks, alt text in Persian, visible focus, respect reduced motion, ≥ AA contrast.
- Persian copy: natural, concise; use ZWNJ (‌) correctly (e.g. «می‌شود»).

## Definition of done
`npm run check` and `npm run build` pass; UI checked at ~390px and ~1280px; docs updated if behaviour or architecture changed.

# Automated SEO

> Two parts: **(A) technical SEO of the site** (sections 1–6, built at build time) and **(B) the automated growth system** (section 7: monitoring, reports, proposals, scheduled workflows).

Status: **implemented and tested; closed to search engines until the owner launches the site.** No paid service and no AI API is used: everything is derived by plain code from the catalogue data the PostgreSQL backend already publishes.

## 1. What it does

| Requirement | How |
|---|---|
| Metadata from **verified** product data | `src/seo/catalog-seo.ts` builds titles, descriptions and alt text only from the published snapshot (`PublicProduct`): name, own description, category, availability, lead time, price. A product is "verified" by being **published** in the backend (only published products are ever written to the snapshot) and by passing schema validation at build time. |
| **Unique** titles and descriptions | Computed over the whole catalogue: two products with the same name get `… (۲)`, identical copied descriptions are prefixed with the (unique) title. Deterministic (slug order). |
| **Canonical URLs** | `<link rel="canonical">` on every page: absolute, percent-encoded, self-referencing (home, category, product). |
| **Product JSON-LD** | `schema.org/Product` with name, description (only if the product has one), images, category, `sku` (single-variant products), and an `Offer` / `AggregateOffer` when a price is known. |
| **Breadcrumbs** | Visible trail + `BreadcrumbList` JSON-LD: خانه › دسته › محصول. |
| **Automatic XML sitemap** | `/sitemap.xml` generated at build time: home, categories that have indexable products, every real product. Sorted, no duplicates. Empty while the site is closed (so it never contradicts `robots.txt`). |
| **Image alt text** | The editor's alt text; if empty, `نام محصول (تصویر ۲ از ۳)`. Every `<img>` has alt (checked on the built HTML). |
| **SEO-friendly Persian URLs** | `/products/دیوارکوب-بافته-پاییزی`, `/category/ماکرومه`. The backend already generates Persian slugs (`slugify`, `slugSchema` allows any letters/digits); URLs are percent-encoded in canonicals, sitemap and JSON-LD. |
| **Indexable product pages** | Real products are `index, follow` once the site is launched; pages are plain pre-rendered HTML with all text, images and alt attributes in the source (no client rendering needed). |
| **PostgreSQL compatibility** | The SEO layer reads exactly the files `SnapshotPublisher` writes (`catalog/manifest.json`, `catalog/categories/*.json`, `catalog/products/*.json`). An integration test creates products through the real catalogue service on PostgreSQL, publishes them, and checks the SEO output. |
| Storefront design preserved | The home page body is identical to before (only the nav anchors became `/#…` so they also work from product pages). New pages reuse the existing components and tokens. |

## 2. Nothing is invented

* No ratings, reviews, brand, GTIN, shipping or return policy, material, colour, dates (`lastmod` is omitted on purpose: snapshots carry no edit time), or priority values. A static check on the built HTML fails if `aggregateRating`, `review`, `brand`, `gtin` or `shippingDetails` ever appear.
* **No price → no offer** (never "price on request"). Descriptions only mention price, availability or lead time when the data has them.
* **Sample content is never indexed or described as real.** The built-in demo catalogue is flagged `isDemo`: its pages are `noindex, nofollow`, are not in the sitemap, carry no Product/Breadcrumb data, and their description says only that it is sample content (no stock/price claims).
* **Currency:** schema.org requires an ISO 4217 code and Toman is not one, so prices are stated in **Rial (IRR = Toman × 10)** as exact strings computed in BigInt (10¹⁵ Toman × 10 exceeds 2⁵³).
* Organisation data on the home page contains only the confirmed brand name and Instagram account: no phone, e-mail or address.

## 3. Where the data comes from (build time)

The site is a static export, so SEO is generated when it is built:

| Environment variable | Meaning |
|---|---|
| `CATALOG_SNAPSHOT_URL` | Public base URL of the bucket that holds the published snapshot (e.g. `https://media.example.ir`). HTTPS required (localhost excepted). Retries transient failures; a missing/invalid manifest **fails the build** rather than silently shipping an empty catalogue. A single invalid product is skipped and reported in the build log. |
| `CATALOG_SNAPSHOT_DIR` | Same files on disk (tests, offline builds). |
| *(neither)* | Built-in sample content (never indexable). This is today's production behaviour. |
| `NEXT_PUBLIC_SITE_URL` | The public origin used for canonicals, sitemap and JSON-LD. **In production a missing or local address yields no canonical/sitemap URLs** instead of a guess. |
| `SEO_ALLOW_INDEXING` | `true` = launched. Anything else keeps `robots.txt` at `Disallow: /`, every page `noindex`, and the sitemap empty. **Also requires a known origin and a real catalogue** (`CATALOG_SNAPSHOT_URL`/`_DIR`): with only the built-in sample content the switch is ignored, so a missing or mistyped catalogue variable can never open the site. |

`robots.txt` is generated (`src/app/robots.ts`) and replaces the old static `public/robots.txt`; its default output is identical to the old one (`Disallow: /`).

## 4. Launch checklist (owner decisions)

1. Real products are published in the backend and the snapshot bucket is publicly readable (`SELF-HOSTING.md`).
2. Set the repository variables `NEXT_PUBLIC_SITE_URL`, `CATALOG_SNAPSHOT_URL` and `SEO_ALLOW_INDEXING=true`.
3. **`cloudflare-pages.yml` currently forwards only `NEXT_PUBLIC_SITE_URL` to the build.** It was deliberately not touched in this change. To use the real catalogue in production, that workflow needs a small, separately reviewed edit that also passes `CATALOG_SNAPSHOT_URL` and `SEO_ALLOW_INDEXING` from repository variables.
4. The site must be **rebuilt when the catalogue changes** (publish a product → new page). Today that means re-running the Pages workflow (push, manual run, or a schedule / `workflow_dispatch` trigger added later). Until then new products have no page.
5. After the first launched deploy: submit `/sitemap.xml` in Google Search Console / Bing Webmaster Tools, spot-check a product with Google's Rich Results Test, and confirm the Persian URLs open on the Cloudflare domain.

## 5. Tests

| Layer | Where | What |
|---|---|---|
| Unit | `src/seo/seo.test.ts`, `src/seo/catalog-source.test.ts` | settings/origin rules, Persian URL handling, titles/descriptions (facts only, uniqueness, determinism), alt text, indexability matrix, JSON-LD (offers, Rial strings, availability, no invented fields, safe serialisation), breadcrumbs, sitemap, robots, snapshot loading/validation/skipping/path safety/HTTPS/retries |
| Integration (real PostgreSQL stack) | `server/seo.integration.test.ts` | products created through the catalogue service → real publisher → SEO output; renames, unpublishing, duplicates, 10¹⁵ price, hostile text, closed mode |
| Built HTML audit | `npm run seo:verify` (also the `SEO` GitHub workflow) | builds the real static site twice (closed, launched) from a snapshot generated by the real backend, then checks every page: one `<h1>`, unique title/description, canonical = sitemap URL, `index`/`noindex`, JSON-LD parses and has no unverifiable fields, breadcrumb positions, all images have alt, robots.txt, sitemap contents |
| Invariants | `server/invariants.test.ts` | raw HTML injection exists only in `src/seo/JsonLd.tsx` (which escapes `<`, `>`, `&`) |

## 6. Known limitations

* **Not connected to the real catalogue in production yet** (see §4). The Pages workflow now forwards `CATALOG_SNAPSHOT_URL` / `SEO_ALLOW_INDEXING` from repository variables and can be re-run by the monitor (§7); with the variables unset nothing changes: the live site stays closed and shows sample pages as `noindex`.
* The home page's product grid is read in the browser, so it is not what crawlers follow: for a real, launched catalogue the home page now also carries plain server-rendered links to every indexable category and (up to 60) product (`CatalogLinks`), and category/product pages link onward (see §7.1).
* Search engines may rewrite titles/descriptions, and indexing is never guaranteed.
* `hreflang` (single language), image sitemap, Open Graph images for sample content, search-box markup and review/rating markup are intentionally absent.
* Persian file names in the static output (`/products/<persian>.html`) are served by Cloudflare Pages by decoding the URL path; this is checked locally but **not verified against Cloudflare yet** — confirm on the first preview.
* Rich-result eligibility was not validated with Google's tools (no network access to them from the build environment); the structured data follows schema.org/Google guidelines.
* Large catalogues lengthen the build (one HTTP request per product, 8 in parallel).

## 7. Automated SEO growth system

### 7.1 What was added on top of the existing technical SEO (audit result)

Already complete before this milestone (kept, not duplicated): build-time metadata from verified data, unique titles/descriptions, canonicals, Persian URLs, Product/Offer/Breadcrumb/Organization/WebSite JSON-LD, sitemap, robots, alt text, sample content never indexable, sold-out → `OutOfStock`, `seo:verify`.
Added: robots.txt closes the private shopping pages and `/api/` after launch; `CollectionPage`/`ItemList` data on category pages; related-product links on every product page (sold-out pages point to pieces that can still be bought); server-rendered catalogue links on the home page; a «انتخاب گزینه و افزودن به سبد خرید» link from the static product page to the buyable page; `seo/overrides.json` (approved title/description improvements, see 7.4); verification of all of this in `seo:verify` and in a real browser (`admin/e2e/seo.e2e.ts`).

### 7.2 Architecture (free, independent of the storefront runtime)

```
 .github/workflows/seo-monitor.yml  (daily + manual)          tools/seo-growth/  (plain TypeScript, no AI, no paid API)
   fetch  ── Search Console API (service account) ──► history   gsc-client   JWT sign-in + searchAnalytics.query, paging, retries
   audit  ── GET public pages of the live site ───► audits/    store         one JSON file per day, byte-identical on re-run
   fingerprint ── catalogue hash ────────────────► rebuild?    analysis      drops, low-CTR pages, ranking opportunities
   report ── weekly (Mon) / monthly (1st) ───────► reports/    tech-audit    robots/sitemap/every page, issues + fix kind
   proposals (Mon) ── pull request, never merged  ◄── seo/     proposals     factual title/description candidates
                                                                tracking      before/after for MERGED improvements
 history lives on the orphan branch `seo-data` (metrics + reports only; main is never written)
```

* Nothing here runs in the storefront, the admin or the API server (an invariant test forbids importing it). It only performs GET requests to public pages and reads Search Console.
* **Free:** GitHub Actions minutes (about 2–3 minutes a day), the Search Console API and a free Google Cloud service account. No paid SEO tool, no AI API.
* **Safe to re-run:** a day's data replaces itself deterministically (an identical re-fetch is not even rewritten), reports are keyed by ISO week/month, the proposals branch name is derived from its content (an existing branch is not recreated), and a run with nothing new commits nothing (tests in `tools/seo-growth/*.test.ts`).
* **Credentials:** `GSC_SERVICE_ACCOUNT_JSON` (secret) and `GSC_SITE_URL` (variable). One-time setup in Persian: `docs/seo/SEARCH-CONSOLE-SETUP-FA.md`. Without them: the audit still runs, reports say there is no Search Console data, nothing is invented. Fixture data (`source: "fixture"`) exists only for tests and previews (`npm run seo:monitor -- demo`), is labelled in every report and is **never** used for proposals.

### 7.3 Monitoring and detection

| Need | How |
|---|---|
| Clicks, impressions, CTR, average position, queries, landing pages | `fetch`: per day, per page and per page+query (largest 1000 / 3000 rows kept), final data only; the last 5 days are re-fetched because Google finalises late |
| Historical metrics | `days/YYYY-MM-DD.json` on the `seo-data` branch |
| Traffic drops | week/28-day vs the previous equal period, site-wide and per page; ≥ 30 % loss with minimum volume (10 clicks before, 5 lost) so noise is not news |
| Ranking opportunities | page+query pairs at positions 4–20 with ≥ 50 impressions, ranked by estimated extra clicks at position 3 |
| High impressions, low CTR | ≥ 200 impressions, position ≤ 20 and CTR < 60 % of what that position usually earns (a coarse heuristic curve, labelled as such) |
| Technical problems | `audit`: robots (blocks, sitemap line, private paths), sitemap (empty/duplicates/foreign/404), per page: status, redirects, noindex (meta and header), canonical, title/description presence and length, duplicates, h1, alt text, JSON-LD validity and unverifiable fields, Open Graph, viewport, orphan pages, sample content indexable. Every issue has a severity and a fix kind (`rebuild`, `proposal`, `manual`) |
| Reports | weekly (7 days vs previous 7) and monthly (28 days) in Persian Markdown: summary, drops, top pages and queries, low-CTR pages, opportunities, technical status, improvement tracking, data coverage (missing days are listed) |

### 7.4 Automated improvement (safe, deterministic, reviewed by a person)

1. **Fixed automatically on every build** (deterministic, no review needed): unique titles/descriptions, length limits, alt-text fallback, canonicals, sitemap/robots, noindex rules, availability in structured data. If the live-site audit still sees such a problem, its fix kind is `rebuild` (an old build is live) and the optional rebuild trigger (7.5) corrects it.
2. **Proposed, never applied silently:** for pages with many impressions and a low CTR, `propose` builds a better title/description **only from the published catalogue** (name, category, availability, price, lead time, the product's own first sentence). It rejects markup, superlatives and guarantees (بهترین، تضمین، …), keyword stuffing, duplicates and texts already tried; skips sold-out and sample products and products whose editor wrote their own SEO text; at most 3 per run and a 56-day cool-down per product.
3. **Pull request:** the weekly workflow opens one PR (branch `seo/proposals-<id>`) that changes `seo/overrides.json`, adds one ledger file per change in `seo/improvements/` (with the page's baseline metrics) and a readable `seo/proposals/<date>.md`. **Nothing is ever merged automatically** (an invariant test forbids merge/auto-merge in the automation). Merging is the approval; the next build uses the text (an editor's own text in the admin still wins).
4. **Tracking after approval:** the merge date comes from git. The page's CTR/clicks/impressions/position over the same number of days before and after (3 days skipped for rebuild and re-crawl), at 14 and 28 days, CTR adjusted by the whole site's change over the same days. Verdicts: improved / worse / neutral / insufficient data (with minimum volume). This is evidence, not proof, and the report says so.

### 7.5 Scheduling and the rebuild trigger

`seo-monitor.yml`: daily 05:41 UTC and on demand (`workflow_dispatch`, with optional report and days inputs). Least privilege: the workflow is `contents: read`; the monitor job gets `contents: write` (only to push the `seo-data` branch through `scripts/seo/data-branch.sh`) and `actions: write` (only for the rebuild trigger); the proposals job gets `contents: write` + `pull-requests: write`. All actions are pinned by SHA, secrets are never echoed.
**Rebuild trigger (off by default):** the monitor hashes everything the storefront build would read from the catalogue; when it changed and `SEO_REBUILD_ON_CATALOG_CHANGE=true`, it re-runs the Pages workflow on `main`. For that, `cloudflare-pages.yml` gained a `workflow_dispatch` trigger (builds/deploys only from `main`; pull requests still get previews; the production branch expression was inverted to "pull requests are previews, everything else is production"). **This edit touches the deployment pipeline: please review it before merging.** It also forwards the optional `CATALOG_SNAPSHOT_URL` / `SEO_ALLOW_INDEXING` variables (when unset, nothing changes).

### 7.6 Tests

* Unit (`tools/seo-growth/*.test.ts`, 70+ tests): Search Console client against a fake Google (RSA-signed JWT verified with the public key, paging, retries/back-off, 401 refresh, 403/404 codes, malformed bodies, no secrets in errors), history store (idempotent, deterministic, bounded, path-safe), analysis detectors (thresholds, noise rejection, designed fixture anomalies), technical audit (every issue code, healthy site clean), proposals (facts only, banned claims, cool-down, determinism, files and idempotence), tracking (windows, adjustment for site-wide swings, insufficient data), reports (no data, fixture banner, coverage, tables), the data-branch script (against a local bare repository: first run, continuation, no-op re-run), the command line.
* Site: `src/seo/*.test.ts` (overrides priority and validation, robots, collection data, related links), `npm run seo:verify` (both build modes).
* Real browser (`admin/e2e/seo.e2e.ts`, Chromium 412×915 touch, Android user agent): launched build from a catalogue created through the real backend — robots, sitemap (every URL opens), per-page head, structured data per product state, sold-out page, draft absent, crawlability by links only, private pages noindex, image hints, layout shift < 0.1, no horizontal scroll — and the closed sample build (nothing indexable). A negative control (removing the home links) makes the crawl tests fail.
* Invariants (`server/invariants.test.ts`): the tools are never imported by the site/admin/server, no merge/auto-merge anywhere, only the history/proposal branches are pushed, minimal permissions, pinned actions, no AI/paid-SEO hosts.

### 7.7 Remaining limitations

* **No real Google data yet:** it needs the owner's one-time setup (Persian guide); a new property takes days to show data. Everything is tested against a fake Google and fixtures only.
* Proposals only cover product titles/descriptions of pages that already have impressions; category/home text, internal-link changes and content growth are not automated.
* The expected-CTR curve and potential clicks are coarse estimates for prioritising.
* Search Console API data is sampled/anonymised by Google (rare queries are missing) and is ~3 days late.
* Bot-created pull requests do not start CI by themselves (GitHub rule); the guide explains how to run it.
* Rich-result eligibility and Core Web Vitals field data are not measured (no Lighthouse/CrUX in the free pipeline); the browser test checks layout shift, image hints and mobile layout only.
* Image sizes: the admin already re-encodes uploads to bounded WebP/JPEG, but the static export has no responsive `srcset`; product pages reserve space with aspect-ratio boxes.

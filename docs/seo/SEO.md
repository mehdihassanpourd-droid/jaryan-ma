# Automated SEO

Status: **implemented and tested; closed to search engines until the owner launches the site.** No paid service and no AI API is used: everything is derived by plain code from the catalogue data the PostgreSQL backend already publishes.

## 1. What it does

| Requirement | How |
|---|---|
| Metadata from **verified** product data | `src/seo/catalog-seo.ts` builds titles, descriptions and alt text only from the published snapshot (`PublicProduct`): name, own description, category, availability, lead time, price. A product is "verified" by being **published** in the backend (only published products are ever written to the snapshot) and by passing schema validation at build time. |
| **Unique** titles and descriptions | Computed over the whole catalogue: two products with the same name get `… (۲)`, identical copied descriptions are prefixed with the (unique) title. Deterministic (slug order). |
| **Canonical URLs** | `<link rel="canonical">` on every page: absolute, percent-encoded, self-referencing (home, category, product). |
| **Product JSON-LD** | `schema.org/Product` with name, description (only if the product has one), images, category, `sku` (single-variant products), and an `Offer` / `AggregateOffer` when a price is known. |
| **Breadcrumbs** | Visible trail + `BreadcrumbList` JSON-LD: خانه › دسته › محصول. |
| **Automatic XML sitemap** | `/sitemap.xml` generated at build time: home, categories that have indexable products, every real product. Sorted, no duplicates. |
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
| `SEO_ALLOW_INDEXING` | `true` = launched. Anything else keeps `robots.txt` at `Disallow: /`, every page `noindex`, and omits the sitemap reference. Requires a known origin. |

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

* **Not connected to the real catalogue in production yet** (see §4: workflow change, rebuild trigger, a published catalogue). Until then the live site stays closed and shows sample pages as `noindex`.
* The **home page is not wired to the real catalogue** and does not link to category pages; discovery of real products relies on category pages, the sitemap and links on product pages. Wiring the storefront to the snapshot is a separate step.
* Search engines may rewrite titles/descriptions, and indexing is never guaranteed.
* `hreflang` (single language), image sitemap, Open Graph images for sample content, search-box markup and review/rating markup are intentionally absent.
* Persian file names in the static output (`/products/<persian>.html`) are served by Cloudflare Pages by decoding the URL path; this is checked locally but **not verified against Cloudflare yet** — confirm on the first preview.
* Rich-result eligibility was not validated with Google's tools (no network access to them from the build environment); the structured data follows schema.org/Google guidelines.
* Large catalogues lengthen the build (one HTTP request per product, 8 in parallel).

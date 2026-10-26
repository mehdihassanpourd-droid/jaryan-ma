# PRD — جریان ما (Jaryan Ma)

> Status: draft v0.1. Items marked **[TBC]** need confirmation from the gallery owner. Nothing in this repo may state real prices, artist names or biographies until supplied by the owner.

## 1. Product summary
- **Brand:** جریان ما — _اینجا هنر در جریان است_
- **Instagram:** @jaryan.ma
- **What:** An online store and gallery for Iranian handmade art, replacing Instagram-DM-only selling with a browsable, trustworthy catalogue.
- **Market / language / currency:** Iran · Persian (RTL, Jalali dates) · Toman (integer amounts).
- **Model:** Single-vendor now (the gallery is the only seller); architecture must allow a multi-vendor marketplace later without a rewrite.

## 2. Goals
1. Present the gallery's work with a premium, minimalist, warm aesthetic.
2. Let visitors discover, view (multi-image galleries) and enquire about / buy works.
3. Give the owner a simple way to manage the catalogue and orders.
4. Be fast on mobile networks in Iran and accessible.
5. Keep data/model ready for multiple vendors.

**Non-goals (this phase):** online payment, shipping-carrier integration, vendor self-service, reviews, auctions.

## 3. Users
| Persona | Needs |
|---|---|
| Visitor / buyer | Browse by category, see detail photos, understand uniqueness, contact or order easily on mobile |
| Gallery owner/admin | Add/edit products and images, manage stock and orders |
| Future vendor (artist) | Own storefront, products and order fulfilment — _later_ |

## 4. Scope by phase
### Phase 0 — Foundation (this PR)
Project scaffold, design system, responsive RTL homepage, demo catalogue, Prisma schema, docs.

### Phase 1 — Catalogue
> Admin/product-management design and tested foundation (self-hosted in Iran, PostgreSQL + S3-compatible storage): [docs/admin/ARCHITECTURE.md](docs/admin/ARCHITECTURE.md).
- Category listing and product detail pages (gallery, description, dimensions, materials, uniqueness/stock).
- Search and filters (category, price range, availability).
- SEO: Persian metadata, sitemap, structured data.
- Real catalogue from PostgreSQL; image upload + optimisation.

### Phase 2 — Ordering (no online payment)
- Cart, address capture, order creation with status `PENDING`.
- Manual order confirmation by admin (phone / Instagram follow-up) **[TBC]**.
- Phone-number (OTP) login. SMS provider **[TBC]** — the account, session, address, favourites, history, export and deletion foundation is built behind a pluggable `SmsProvider` ([docs/customers/CUSTOMERS.md](docs/customers/CUSTOMERS.md)); no SMS service is active.
- Customer support: tickets, internal notes, Persian FAQ ([docs/support/SUPPORT.md](docs/support/SUPPORT.md)) — foundation built, UI pending.
- Admin panel: products, categories, orders.

### Phase 3 — Payments
Iranian payment gateway integration (e.g. Zarinpal/IDPay) **[TBC]** — requires owner contract and credentials; explicitly **not started**.

### Phase 4 — Marketplace
Vendor onboarding and approval, vendor dashboard, per-vendor order splitting, commission and payouts, vendor public pages.

## 5. Functional requirements (homepage, Phase 0)
- Header with brand and navigation; mobile menu.
- Hero with slogan and CTA.
- Category grid, featured products (cards), product gallery spotlight, brand story, Instagram CTA, footer.
- Clearly labelled **demo content**: site-wide banner and "نمونه" badges; prices are not shown ("قیمت به‌زودی اعلام می‌شود").

## 6. Non-functional requirements
- **Design:** warm ivory, beige, natural brown, muted olive; generous whitespace; Vazirmatn typography; mobile-first.
- **RTL/i18n:** `lang="fa" dir="rtl"`, logical CSS properties, Persian digits for display, LTR islands for handles/URLs.
- **Performance:** static/ISR rendering where possible, optimised images, self-hosted fonts (no third-party font CDN).
- **Accessibility:** WCAG 2.1 AA target, semantic landmarks, visible focus, keyboard-usable gallery, reduced-motion support.
- **Security:** no secrets in git, server-side validation, least-privilege roles, rate-limited auth (Phase 2).
- **Quality:** TypeScript strict, ESLint, tests for logic, CI running lint/typecheck/test/build.

## 7. Data (summary)
User, Vendor (+members), Category, Product (priceToman integer, nullable), ProductImage, Address, Order, OrderItem (denormalised `vendorId`). See `prisma/schema.prisma`.

## 8. Success metrics (proposed)
Mobile Lighthouse ≥ 90 (performance & accessibility); catalogue page → enquiry/order conversion; share of orders no longer handled via DM.

## 9. Open questions
1. Real category list and product attributes (dimensions, materials, care)?
2. Order flow before payments: enquiry-only, or cash-on-delivery / bank transfer confirmation?
3. Shipping rules and cities served?
4. Artist credit policy: will artists be shown per work?
5. Logo, brand fonts/colours if already existing, and photography source.
6. Hosting: Iran-based or abroad (affects payment/SMS providers and latency)?

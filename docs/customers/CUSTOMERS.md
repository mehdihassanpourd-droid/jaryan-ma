# Customer accounts

Status: **foundation, order placement (no payment) and the storefront cart/checkout screens are implemented and tested; no paid service is active, nothing is deployed.** Customer sign-in is **off by default in production** (`CUSTOMER_ACCOUNTS_ENABLED`) and stays off until the owner chooses and configures an SMS gateway.

## 1. What exists

| Area | Implemented | Where |
|---|---|---|
| Customer profile (phone, name, optional e-mail, marketing opt-in, terms version) | yes | `Customer` model, `PrismaCustomerStore` |
| Phone-based registration + sign-in with a one-time code (no passwords) | yes | `OtpService`, `CustomerAuthService` |
| Secure server-side sessions (HttpOnly cookie, CSRF token) | yes | `CustomerSessionAuthenticator`, `server/customer-api.ts` |
| Several shipping addresses (max 10, exactly one default) | yes | `Address`, `PrismaAccountStore` |
| Favourites (published products only, max 500) | yes | `Favorite` |
| Order history | yes (model + API + storefront page `/orders`) | `Order`, `OrderItem` |
| **Order placement** (`POST /orders`): a pending order built from the cart, priced and checked by the server, idempotent, with its stock reserved | yes; **no payment, no notification** (see §8, §9) | `CheckoutService` |
| Order management: confirm / reject / cancel / prepare / ship / deliver, history, audit | yes (staff in the admin app; the customer may cancel a PENDING order) | `OrderLifecycleService` (§9) |
| Data export (JSON) | yes | `AccountService.exportData` |
| Account deletion (14-day grace period, then anonymisation) | yes | `AccountService`, `PrismaAccountStore.anonymize` |
| Pluggable SMS provider | yes: interface + `disabled` (default), `console` (dev only), `memory` (tests), generic `http` | `server/sms/provider.ts` |
| Storefront UI: sign-in with the code, cart, checkout, order confirmation, order history | yes, for builds that have an order system (§8); other builds get a labelled DEMO checkout | `src/components/shop/` |
| Account pages (profile, addresses book editing, favourites, support, data export/deletion screens) | **planned** | — |
| Payment | **not started (PRD phase 3)** | — |

## 2. Sign-in flow

1. `POST /api/v1/customer/auth/request-code {phone}` → a 6-digit code is sent by SMS. The answer is identical for registered and unknown numbers (no account enumeration) and never contains the code.
2. `POST /api/v1/customer/auth/verify {phone, code, acceptTerms}` → sets the session cookie. A **new** number must send `acceptTerms: true` (the valid code is *not* consumed when it is missing, so the person can just tick the box and retry). Registration happens here; there is no separate sign-up.
3. `POST /api/v1/customer/auth/logout` ends the session.

Phone numbers are normalised (Persian/Arabic digits, `0912…`, `+98 912…`, `0098…` all accepted) to `+989XXXXXXXXX`. Landlines, foreign numbers and obviously fake numbers are rejected.

### One-time code properties

* Generated with `crypto.randomInt`; **only an HMAC-SHA-256 of the code is stored** (key derived by HKDF from `APP_ENCRYPTION_KEY`, bound to the challenge id and phone). A stolen database does not reveal codes.
* Valid for **5 minutes**, **5 wrong guesses** destroy it, **single use** (atomic compare-and-set; two parallel requests cannot both succeed), only the newest code per number is valid.
* All failures are the same `invalid_code`: nothing leaks about expiry, attempts or accounts.

### Abuse / cost protection (SMS pumping)

Counted in the database, so limits survive restarts and multiple instances:

| Limit | Default |
|---|---|
| Gap between two codes to one number | 60 s |
| Per number | 3 per 15 min, 10 per day |
| Per client address (IP) | 20 sends per hour; 30 code checks per 15 min |
| **Whole site** | `SMS_DAILY_LIMIT` (default 300 codes / 24 h) — a hard ceiling on the SMS bill whatever an attacker does |

When a limit is reached the API answers `429` with `Retry-After`; when the daily site budget is exhausted or the gateway fails it answers `503 sms_unavailable` and logs a warning (no phone number in the log).

### Sessions

* 256-bit random token in an `HttpOnly; SameSite=Strict; Secure` cookie (`__Host-jm_c` in production); only its SHA-256 is stored.
* Idle timeout 14 days, absolute 30 days; deleted server-side on logout, deletion request (other sessions) and anonymisation.
* Every state-changing request needs (a) an `Origin` on the `CUSTOMER_ORIGINS` allow-list **and** (b) the `x-csrf-token` returned at sign-in.
* A customer session is not an admin session and vice versa (different cookie, store, origins and routes — tested).
* `SameSite=Strict` means the storefront and the API must share a registrable domain (e.g. `shop.example.ir` and `api.example.ir`). Cross-site cookies are deliberately not supported.

## 3. SMS providers

The application depends only on the `SmsProvider` interface. **No paid SMS service is activated.**

| `SMS_PROVIDER` | Use | Production |
|---|---|---|
| `disabled` (default in production) | sending is impossible; sign-in answers `503 sms_unavailable` | allowed (accounts must then stay disabled) |
| `console` (default in development) | prints the message **including the code** to the server log | **refused at startup** |
| `http` | JSON-over-HTTPS gateway adapter configured entirely by environment variables | needs `SMS_HTTP_URL` (https), `SMS_HTTP_BODY_TEMPLATE` with `{{to}}`/`{{text}}`, optional `SMS_HTTP_AUTH_HEADER` |

Enabling customers in production (`CUSTOMER_ACCOUNTS_ENABLED=true`) additionally requires `CUSTOMER_ORIGINS` (explicit https origins) and `SMS_PROVIDER=http`; the server refuses to start otherwise. Placeholder-only example: see `.env.example`.

> **Not verified against a real gateway.** The `http` adapter is tested against a fake server only (URL/https enforcement, JSON-escaping of values, error mapping, timeout). Before going live, choose an Iranian provider whose API fits (or write a small adapter against the same interface), send a test message, and confirm delivery times and costs. Registration with the national SMS regulator / sender-ID rules are the owner's responsibility.

## 4. Data model

`Customer` (phone unique, status `active | pending_deletion | anonymized | suspended`), `CustomerOtp`, `CustomerSession`, `Address` (partial unique index → at most one default per customer, enforced by the database), `Favorite`, `CustomerDataRequest`, `Order` / `OrderItem` (line items snapshot title, SKU, variant, image, unit price, vendor; `vendorId` on every line for the multi-vendor phase).

## 5. Customer API (all under `/api/v1/customer`, JSON)

| Method & path | Purpose |
|---|---|
| `POST /auth/request-code`, `POST /auth/verify`, `POST /auth/logout` | sign-in |
| `GET /me`, `PATCH /me` | profile (`firstName`, `lastName`, `email`, `marketingOptIn` only; the phone/status cannot be changed — unknown keys are rejected) |
| `GET/POST /addresses`, `PUT/DELETE /addresses/:id`, `POST /addresses/:id/default` | addresses |
| `GET /favorites`, `PUT/DELETE /favorites/:slug` | favourites |
| `POST /orders` | place a pending order (§8) |
| `POST /orders/:number/cancel` | cancel your own PENDING order (stock goes back) |
| `GET /orders`, `GET /orders/:number` | order history |
| `GET/POST /support/tickets`, `GET /support/tickets/:number`, `POST …/reply` | support (see [SUPPORT.md](../support/SUPPORT.md)) |
| `POST /account/export` | JSON download of the customer's data (once per hour) |
| `POST /account/delete`, `POST /account/delete/cancel` | deletion with grace period |

Public: `GET /api/v1/public/faq`, `POST /api/v1/public/client-errors`, `GET /health`.

Every route checks ownership by `customerId` taken from the session, never from the request; another customer's resource is answered with `404`, exactly like a missing one (tested for addresses, orders and tickets).

## 6. Data export and deletion

**Export** contains: profile, addresses, favourites, orders (with line items), number of active sessions, and the customer's support tickets with the messages they can see. It never contains internal staff notes, other people's data, session tokens, CSRF tokens or one-time-code data. Requests are recorded.

**Deletion:**

1. Requested from the account (refused while an order is still open: pending/confirmed/preparing/shipped). All *other* sessions are signed out; the customer can cancel for **14 days**.
2. After the grace period the scheduled job (`AccountService.runDeletions`, hourly; or `npm run ops -- run-deletions`) anonymises in one transaction:

| Removed | Kept (reason) |
|---|---|
| name, e-mail, marketing consent, phone number (replaced by `deleted:<id>`, which frees the number for a new registration) | the order rows: number, date, status, totals and line items (accounting records) |
| all addresses, favourites, sessions, one-time codes | province and city of the delivery snapshot (non-identifying statistics) |
| recipient name, phone, street, plaque, unit, postal code and note inside order delivery snapshots | ticket category, status and timestamps (the fact a ticket existed) |
| ticket subjects, message bodies and internal notes about that customer (replaced by `[حذف شده]`) | an audit entry `customer.anonymized` with counts only |

> Retention periods required by Iranian commercial/tax law are a **legal question for the owner**; this design keeps only order amounts and dates after deletion. Adjust `anonymize` if a longer or shorter retention applies.

## 7. Known limitations

* In-memory burst limiter (per process) on top of the durable database limits; a multi-instance deployment needs a shared limiter (documented trade-off).
* No phone-number change flow, no e-mail verification, no staff action to suspend/restore a customer through the API yet (status exists in the model; `suspended` customers cannot sign in).
* Customers can only place orders and cancel their own PENDING ones; every other change is staff-only (§9). Returns and refunds after shipping are not modelled.
* Consent text (terms/privacy policy) is only a version string; the documents themselves are the owner's.

## 8. Shopping: cart, checkout, orders (no payment)

**What a shopper can do** (storefront builds with `NEXT_PUBLIC_CATALOG_URL`; see docs/admin/ARCHITECTURE.md §7): choose a variant and quantity on the product page, keep a cart across reloads, see exact prices and totals, check out, and read the order afterwards.

* **The cart** (`src/lib/cart.ts`) stores only `{slug, sku, quantity}` in the browser (`localStorage`, shared between tabs, in memory when storage is blocked). Prices, titles, images and availability are re-read from the live catalogue every time it is shown, so it can never show or submit a stale price. Unique pieces are in the cart once; at most 20 of anything per line, 50 lines. Unpublished, sold-out, variant-less or unpriced lines are flagged and left out of the total. Totals use `BigInt` (`lineTotal`), exact even above 2⁵³.
* **Checkout** (`/checkout`) collects the recipient, mobile number, province (31 listed), city, address, plaque, unit, postal code and an optional note, validated with the SAME schema as the server (`shippingInputSchema`). A signed-in customer's default saved address pre-fills the form; "save this address" stores it in the address book.
* **`POST /api/v1/customer/orders`** (`CheckoutService`) needs a customer session, the CSRF token and an allowed origin. The request names products, variants and quantities: **never prices, titles, totals or customer ids** (unknown keys are rejected). The server reads published products from the database, checks each line (`not_found`, `variant_required`, `variant_not_found`, `sold_out`, `insufficient_stock` with how many are left, `quantity_not_allowed`, `no_price`; all lines reported at once as `409 items_unavailable`), computes the exact total, snapshots title/SKU/variant/image/unit price/vendor into the order and stores a **pending** order. `order_total_out_of_range` (422) refuses a total beyond the exact range. At most 10 open orders per customer; accounts being deleted cannot order.
* **Idempotency:** the browser sends a `requestId` per checkout attempt (unique per customer in the database). A retry, even a concurrent one, returns the first order (`created: false`) instead of a second one.
* **No payment, no notification, but stock IS reserved.** Placing an order takes its quantity out of the product's (or the chosen variant's) `inventory` in the same transaction (§9); nothing is charged and nobody is notified (staff see the "new orders" indicator in the admin app while it is open).
* **Demo checkout:** a build WITHOUT `NEXT_PUBLIC_ORDER_API_URL` has no order system. Its checkout page says so in a dashed banner, creates nothing, shows no order number, keeps the cart and only builds a text the shopper can copy and send to the gallery on Instagram ("پیش‌نمایش سفارش (ثبت نشده)"). The same fallback is offered when the SMS service is unavailable or the API is unreachable. This is also the only way to order in production until SMS and the API are deployed.
* **Order pages:** `/order?number=N` (confirmation and detail) and `/orders` (history) read the signed-in customer's own orders; another customer's number is "not found".

**Not available until production infrastructure exists:** the customer API itself (needs the backend deployed on a domain that shares a registrable domain with the storefront, `CUSTOMER_ORIGINS`, `CUSTOMER_ACCOUNTS_ENABLED=true`), an SMS gateway (`SMS_PROVIDER=http`; without it nobody can sign in), the owner's terms and privacy texts (the sign-up checkbox refers to them, but no such pages exist yet), the shipping-cost and delivery rules (the total says shipping is not included), and a way to notify the owner of a new order.

## 9. Order management and inventory safety

**Meaning of `inventory`:** the number of units still available to order. An order takes its units out of it when it is placed (a reservation) and gives them back only if it ends rejected or cancelled; a shipped or delivered order keeps them taken. Made-to-order lines have no stock and reserve nothing.

**Reservation** (`server/orders/stock.ts`, inside the order's own transaction): the product rows are locked in id order and their `version` is bumped (so an admin editing a stale copy of the product gets a version conflict instead of overwriting the stock an order just reserved), then each line runs `UPDATE … SET inventory = inventory - q WHERE inventory >= q AND status = 'published'` and counts the affected rows. PostgreSQL serialises updates of the same row, so concurrent orders can never both get the last unit; if any line fails the whole transaction rolls back (no partial holds) and the shopper gets `409 items_unavailable` naming the lines, with how many are left. The database's own `CHECK`s (stock ≥ 0, unique pieces 0/1, `reservedQuantity` between 0 and the ordered quantity) are the last safety net. `OrderItem.reservedQuantity` records what an order currently holds.

**Release:** ending an order as `rejected` or `cancelled` flips the status with `UPDATE … WHERE status = <what we read>`, claims each line's hold by zeroing `reservedQuantity` (only the transaction that zeroes it returns the units), and gives the units back to the same variant/product; a unique piece never goes above 1 even if staff re-stocked it by hand. Two simultaneous cancels, or a confirm racing a cancel, therefore have exactly one winner and the stock is returned once. Deadlocks between concurrent transactions are rolled back by PostgreSQL and retried (up to 3 times). After any stock movement the product's public snapshot is refreshed (a sold unique piece reads "sold out" on the storefront within the cache time; it comes back on cancel).

**Statuses** (`src/domain/customer/order-status.ts`, enforced by the server, also used by the apps to choose buttons):

| From | Staff may move to | Customer may |
|---|---|---|
| pending | confirmed, rejected (reason), cancelled (reason) | cancel (own order only) |
| confirmed | preparing, cancelled (reason) | — |
| preparing | shipped, cancelled (reason) | — |
| shipped | delivered | — |
| delivered / cancelled / rejected | final | — |

Staff actions need `order:manage` (owner and support) and carry the status the screen showed (`expectedStatus`): if someone else changed the order first, nothing happens and the screen reloads the real state (`409 order_changed`). The optional reason (≤ 200 characters) is **shown to the customer**; it is scrubbed when the customer is anonymised.

**History and audit:** every change writes an `OrderStatusEvent` (from, to, who: customer / staff e-mail / system, reason, time, strictly ordered by `seq`) and an `AuditLog` row (`order.<status>`, order number, from, to, units released; never a phone number) in the same transaction as the change. Orders that existed before this feature got one "migrated" history entry and hold no stock (cancelling them gives nothing back). The customer sees their own history (status, time, who in general terms, reason) on `/order?number=N` and in the order list, re-read when they return to the tab and every minute; staff see the full history with identities.

**Admin app:** the orders list shows open orders first (pending on top, highlighted); a banner on every screen, a badge on the "سفارش‌ها" tab, the page title and a toast announce orders waiting for a decision. The count comes from `GET /api/v1/orders/summary`, polled from the admin's own server every 30 s while the page is visible (no push service, no foreign dependency).

**Known limits / decisions for the owner:** unconfirmed pending orders hold stock until someone acts (there is no automatic expiry; the per-customer cap is 10 open orders); `inventory` edited by hand or overwritten by a CSV import means "available now" (an import can therefore re-open stock that open orders hold: review open orders before importing); no refunds, returns or partial cancellation; no notification outside the app (SMS is off by design).

**Resilience requirement:** the store must keep working inside Iran during international internet shutdowns, so nothing here (or anywhere) may depend at run time on a foreign service. `server/invariants.test.ts` fails if storefront or admin source references a foreign absolute URL, and `admin/e2e/order-management.e2e.ts` fails if any page requests a non-local host.

## 10. Shipping and delivery

Checkout now asks for a delivery method (post, Tipax, local courier, pickup). The server prices it from the owner's rate table, the customer sees the fee and the final total **before** ordering, and the order stores the method, the fee and the frozen quote. Staff enter carrier and tracking; customers see them on `/order`. Full description, rules and the provider architecture: `docs/shipping/SHIPPING.md`.

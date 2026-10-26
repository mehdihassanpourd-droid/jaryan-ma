# Customer accounts

Status: **foundation implemented and tested; no UI, no paid service active, nothing deployed.** Customer sign-in is **off by default in production** (`CUSTOMER_ACCOUNTS_ENABLED`) and stays off until the owner chooses and configures an SMS gateway.

## 1. What exists

| Area | Implemented | Where |
|---|---|---|
| Customer profile (phone, name, optional e-mail, marketing opt-in, terms version) | yes | `Customer` model, `PrismaCustomerStore` |
| Phone-based registration + sign-in with a one-time code (no passwords) | yes | `OtpService`, `CustomerAuthService` |
| Secure server-side sessions (HttpOnly cookie, CSRF token) | yes | `CustomerSessionAuthenticator`, `server/customer-api.ts` |
| Several shipping addresses (max 10, exactly one default) | yes | `Address`, `PrismaAccountStore` |
| Favourites (published products only, max 500) | yes | `Favorite` |
| Order history (read-only) | yes (model + API); **no checkout, so nothing creates orders yet** | `Order`, `OrderItem` |
| Data export (JSON) | yes | `AccountService.exportData` |
| Account deletion (14-day grace period, then anonymisation) | yes | `AccountService`, `PrismaAccountStore.anonymize` |
| Pluggable SMS provider | yes: interface + `disabled` (default), `console` (dev only), `memory` (tests), generic `http` | `server/sms/provider.ts` |
| Customer UI (sign-in screens, account pages) | **planned** | — |
| Checkout, payment, order creation | **planned (PRD Phase 3); not started** | — |

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
* Orders can only be read: there is no checkout. The `createOrder` store method exists for the future checkout and validates totals exactly.
* Consent text (terms/privacy policy) is only a version string; the documents themselves are the owner's.

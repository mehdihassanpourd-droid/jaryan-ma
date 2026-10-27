# Shipping and delivery

Status: **implemented and tested with admin-configured rates only.** No carrier or postal API is connected, no payment is taken, nothing is deployed.

## 1. What a customer and the owner can do

| | |
|---|---|
| Methods | `post` (پست), `tipax` (تیپاکس), `local_courier` (پیک محلی), `pickup` (تحویل حضوری). All four start **disabled**; the owner switches on what the gallery really offers. |
| Prices | The owner writes **rate rows** per method: provinces (empty = everywhere), optional cities, a weight band in grams (`min`–`max`, no maximum allowed) and a price in whole Toman. Screen: admin → «ارسال» (`/api/v1/shipping/config`, owner only). |
| Free shipping | Per method: from an items subtotal of N Toman the fee is 0 — but only to destinations the owner priced (free shipping never invents coverage). Pickup is always free. |
| Weight | `Product.weightGrams` (editor field «وزن یک عدد»); a product without weight uses the shop default (500 g, editable) per unit; a packaging weight is added once per order. |
| Delivery time | Optional min/max days per method, shown as «حدود ۳ تا ۷ روز». Left empty = no promise is shown. |
| Pickup | No address is asked for or stored (only name and phone). The owner's note (place, hours) is shown to the customer. |
| Order record | `Order.subtotalToman`, `shippingFeeToman`, `totalToman` (= subtotal + fee), `deliveryMethod`, `deliveryDetails` (rate row, weight, free?, days, note — frozen). Later price changes never touch an existing order. Orders made before this feature keep `deliveryMethod = null`, fee 0, `subtotal = total`. |
| Carrier + tracking | Staff enter a carrier (`post`/`tipax`/`local_courier`/`pickup`/`other` + name) and an optional tracking code, together with «ثبت ارسال» or later (also corrections, up to and after delivery) via `PUT /api/v1/orders/:n/shipment`. Customers see the carrier and code on their order page together with a plain-language delivery status. Tracking codes are plain text (letters, digits, `- _ . /`, ≤ 64) and are not written to the audit log. |

## 2. Rules the server enforces

1. **The browser never sends or decides a fee.** Checkout sends only the method and the fee it *showed* (`expectedFeeToman`). The server recomputes the fee from the database (lines, product weights, rates); a different fee → `409 delivery_fee_changed` with the current prices, nothing is ordered and no stock is reserved. A method that is off or does not serve the address → `409 delivery_unavailable`.
2. **Quote endpoint** `POST /api/v1/customer/shipping/quote` (signed-in customers): same engine, read-only. Without an address only pickup can be priced.
3. **Rate matching** (`src/domain/shipping/pricing.ts`, pure): city row beats province row beats «anywhere» row; then the narrower weight band; then the first row. Cities are compared after letter/digit normalisation (كرج = کرج). The owner's save refuses overlapping bands for the same place, enabled methods without any rate, pickup rates/thresholds, cities without a province.
4. **Saving the table** is optimistic (`expectedVersion`): a save from an outdated screen is refused (409) and the current table is returned, so nothing is silently overwritten. It is audited (`shipping.config`: switches and counts only).
5. **Address**: carried deliveries need the full validated address (same schema as the address book); pickup accepts only name + phone (an address sent with pickup is refused, so nothing extra is stored).
6. Money: whole Toman, `BigInt` sums, range-checked (`MAX_TOMAN`).
7. **Permissions**: `shipping:read` / `shipping:manage` — owner only. Entering carrier and tracking is `order:manage` (owner, support).
8. **Privacy**: tracking codes are not personal data; customers' addresses are scrubbed on anonymisation exactly as before; data export includes the delivery fields.

## 3. Provider architecture (for later Iranian postal / courier APIs)

```
checkout / quote endpoint ──► ShippingService ──► ShippingProvider[]   (server/shipping/)
                                   │                  └─ ManualRatesProvider  ← the owner's table (today)
                                   └─ weight from ShippingConfigStore
```

* `ShippingProvider` (`server/shipping/provider.ts`) = `{ id, methods, quote(context), trackingUrl?() }`.
* The first registered provider that lists a method answers for it. A provider that throws only makes *its* methods unavailable (logged as `shipping.provider_failed`); the rest of the checkout keeps working.
* To add an API-backed provider: implement the interface in one new file (the only place a vendor SDK/URL may appear, CLAUDE.md rule 7), register it in `createPlatformServices` before/after `ManualRatesProvider`, and keep it free of the order-time network when possible (e.g. cache tariffs); the fee frozen on the order is what the customer was shown. `trackingUrl` may return a public tracking page; customers then get a link next to the code (none is configured today, so no foreign link exists).
* Orders store only the method and a frozen quote, never a provider identity, so switching providers later cannot change old orders.

## 4. No foreign runtime dependency

Prices, quotes and tracking entry only use the shop's own server. `server/invariants.test.ts` and the browser tests (`admin/e2e/shipping.e2e.ts`) fail if a page contacts a non-local host.

## 5. Tests

* Unit: `src/domain/shipping/*.test.ts` (matching, thresholds, config rules), checkout/order schema tests.
* Server (real PostgreSQL 16 in CI): `server/shipping/shipping.test.ts` — config API (permissions, validation, version conflicts, audit), quotes by destination/weight/method, free-shipping to the Toman, ordering with the server's fee, tampering, pickup, retries, price changes after ordering, legacy orders, carrier/tracking rules, provider failover.
* Browser (`admin/e2e/shipping.e2e.ts`, Chromium at 412×915 touch, PostgreSQL 16): owner configures everything in the real screen; customer checkout with live prices; price changed mid-checkout; free shipping; too heavy for a method; pickup; ship with tracking and correct it; legacy order; axe; no horizontal scroll; no foreign hosts.

## 6. Known limitations

* No carrier API, no label printing, no automatic tracking updates (staff enter them).
* One shipment per order; split shipments and returns are later features.
* The weight default (500 g) is a technical default the owner should review; it is not a business fact.
* No VAT/insurance/cash-on-delivery fees; payment is not active.

/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted field by field */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLIENT_IP_HEADER, CSRF_HEADER } from "./api";
import { createTestDatabase, type TestDatabase } from "./db/test-database";
import { buildTestApp, CUSTOMER_COOKIE, STORE_ORIGIN, type TestApp } from "./testing/app";
import { validateProductInput } from "../src/domain/product/schema";

let testDb: TestDatabase;
let app: TestApp;
let categoryId: string;

beforeAll(async () => void (testDb = await createTestDatabase()), 60_000);
afterAll(async () => testDb.close());
beforeEach(async () => {
  app = await buildTestApp(testDb);
  categoryId = (await app.repo.createCategory({ slug: "wall", name: "دیوارکوب" })).id;
});

const ACTOR = "owner@example.test";
const SHIPPING = { recipientName: "علی رضایی", recipientPhone: "09121234567", province: "تهران", city: "تهران", street: "خیابان ولیعصر، کوچه گل", postalCode: "1459813176" };
let counter = 0;
const requestId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

async function product(raw: Record<string, unknown>, status: "published" | "draft" | "archived" = "published") {
  const parsed = validateProductInput({ fulfillment: "unique", categoryId, images: [{ key: "images/p/a.webp", alt: "تصویر" }], priceToman: 1_000_000, ...raw });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  let p = await app.catalog.create({ ...parsed.value, status: "draft" }, ACTOR);
  if (status !== "draft") p = await app.catalog.setStatus(p.id, status, p.version, ACTOR);
  return p;
}

interface Customer {
  cookie: string;
  csrf: string;
  id: string;
}
async function call(path: string, o: { method?: string; as?: Customer | null; body?: unknown; origin?: string | null; csrf?: string | null; ip?: string } = {}) {
  const method = o.method ?? "GET";
  const headers: Record<string, string> = { [CLIENT_IP_HEADER]: o.ip ?? "198.51.100.5" };
  if (o.as) headers.cookie = o.as.cookie;
  if (method !== "GET") {
    if (o.origin !== null) headers.origin = o.origin ?? STORE_ORIGIN;
    const csrf = o.csrf === undefined ? o.as?.csrf : o.csrf;
    if (csrf) headers[CSRF_HEADER] = csrf;
  }
  let body: string | undefined;
  if (o.body !== undefined) {
    body = JSON.stringify(o.body);
    headers["content-type"] = "application/json";
  }
  const res = await app.customerApi(new Request(`https://api.example.test${path}`, { method, headers, body }));
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any, res };
}

async function signIn(phone = "09121234567", e164 = "+989121234567"): Promise<Customer> {
  await call("/api/v1/customer/auth/request-code", { method: "POST", body: { phone } });
  const r = await call("/api/v1/customer/auth/verify", { method: "POST", body: { phone, code: app.sms.lastCode(e164)!, acceptTerms: true } });
  expect(r.status).toBe(200);
  const token = /jm_c=([^;]+)/.exec(r.res.headers.get("set-cookie") ?? "")?.[1];
  const me = await testDb.db.customer.findUniqueOrThrow({ where: { phone: e164 } });
  return { cookie: `${CUSTOMER_COOKIE}=${token}`, csrf: r.body.csrfToken, id: me.id };
}

const place = (as: Customer | null, items: unknown[], extra: Record<string, unknown> = {}, o: Parameters<typeof call>[1] = {}) =>
  call("/api/v1/customer/orders", { method: "POST", as, body: { items, shipping: SHIPPING, requestId: requestId(), ...extra }, ...o });

describe("placing an order (pending, no payment)", () => {
  it("builds the order from the DATABASE: exact prices, titles, variant, total; nothing about money comes from the browser", async () => {
    const rug = await product({
      name: "کوسن بافته", fulfillment: "stocked",
      variants: [{ sku: "K-S", options: { size: "S" }, inventory: 5, priceToman: 500_000 }, { sku: "K-L", options: { size: "L" }, inventory: 3, priceToman: 800_000 }],
    });
    const me = await signIn();
    const r = await place(me, [{ slug: rug.slug, sku: "K-L", quantity: 2 }, ], { customerNote: "  لطفاً بسته‌بندی هدیه  " });
    expect(r.status).toBe(201);
    expect(r.body.created).toBe(true);
    const order = r.body.order;
    expect(order.status).toBe("pending");
    expect(order.totalToman).toBe(1_600_000);
    expect(order.customerNote).toBe("لطفاً بسته‌بندی هدیه");
    expect(order.items).toEqual([expect.objectContaining({ title: "کوسن بافته", sku: "K-L", variant: { size: "L" }, unitPriceToman: 800_000, quantity: 2, imageKey: "images/p/a.webp" })]);
    expect(order.shipping).toMatchObject({ recipientName: "علی رضایی", recipientPhone: "+989121234567", province: "تهران", postalCode: "1459813176" });

    // it is the customer's own history, and every line carries a vendor
    const history = await call("/api/v1/customer/orders", { as: me });
    expect(history.body.items.map((o: any) => o.number)).toEqual([order.number]);
    const rows = await testDb.db.orderItem.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.vendorId).toBeTruthy();
  });

  it("rejects prices/totals/ids sent by the browser (the request has no place for them)", async () => {
    const p = await product({ name: "اثر" });
    const me = await signIn();
    for (const extra of [{ totalToman: 1 }, { priceToman: 1 }, { customerId: "someone-else" }]) {
      expect((await place(me, [{ slug: p.slug, quantity: 1 }], extra)).status).toBe(422);
    }
    expect((await place(me, [{ slug: p.slug, quantity: 1, priceToman: 1 }])).status).toBe(422);
    expect(await testDb.db.order.count()).toBe(0);
  });

  it("does not take payment, reserve or change stock (the owner confirms; stock moves only then)", async () => {
    const p = await product({ name: "اثر", fulfillment: "stocked", inventory: 4 });
    const me = await signIn();
    expect((await place(me, [{ slug: p.slug, quantity: 3 }])).status).toBe(201);
    expect((await testDb.db.product.findUniqueOrThrow({ where: { id: p.id } })).inventory).toBe(4);
  });

  it("freezes the snapshot: a later price change or archiving does not alter an existing order", async () => {
    const p = await product({ name: "اثر اولیه", priceToman: 1_000_000 });
    const me = await signIn();
    const placed = (await place(me, [{ slug: p.slug, quantity: 1 }])).body.order;
    await testDb.db.product.update({ where: { id: p.id }, data: { name: "نام تازه", priceToman: 9_000_000n, status: "archived" } });
    const read = (await call(`/api/v1/customer/orders/${placed.number}`, { as: me })).body.order;
    expect(read.totalToman).toBe(1_000_000);
    expect(read.items[0]).toMatchObject({ title: "اثر اولیه", unitPriceToman: 1_000_000 });
  });
});

describe("what can NOT be ordered", () => {
  it("draft, archived and unknown products: 409 items_unavailable per line, nothing created", async () => {
    const draft = await product({ name: "پیش‌نویس" }, "draft");
    const archived = await product({ name: "آرشیو" }, "archived");
    const live = await product({ name: "زنده" });
    const me = await signIn();
    const r = await place(me, [{ slug: draft.slug, quantity: 1 }, { slug: archived.slug, quantity: 1 }, { slug: "no-such-product", quantity: 1 }, { slug: live.slug, quantity: 1 }]);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("items_unavailable");
    expect(r.body.items.map((i: any) => [i.slug, i.reason])).toEqual([[draft.slug, "not_found"], [archived.slug, "not_found"], ["no-such-product", "not_found"]]);
    expect(await testDb.db.order.count()).toBe(0);
  });

  it("sold out, not enough stock (says how many are left), more than one unique piece, missing or unknown variant, no price", async () => {
    const sold = await product({ name: "فروخته‌شده", inventory: 0 });
    const few = await product({ name: "کم", fulfillment: "stocked", inventory: 2 });
    const unique = await product({ name: "یگانه" });
    const withVariants = await product({ name: "گونه", fulfillment: "stocked", variants: [{ sku: "V1", options: { size: "S" }, inventory: 1, priceToman: 100_000 }] });
    const unpriced = await product({ name: "بی‌قیمت" });
    await testDb.db.product.update({ where: { id: unpriced.id }, data: { priceToman: null } });
    const me = await signIn();
    const r = await place(me, [
      { slug: sold.slug, quantity: 1 }, { slug: few.slug, quantity: 3 }, { slug: unique.slug, quantity: 2 },
      { slug: withVariants.slug, quantity: 1 }, { slug: withVariants.slug, sku: "NOPE", quantity: 1 }, { slug: unpriced.slug, quantity: 1 },
    ]);
    expect(r.status).toBe(409);
    expect(r.body.items.map((i: any) => [i.slug, i.reason, i.available])).toEqual([
      [sold.slug, "sold_out", undefined], [few.slug, "insufficient_stock", 2], [unique.slug, "quantity_not_allowed", undefined],
      [withVariants.slug, "variant_required", undefined], [withVariants.slug, "variant_not_found", undefined], [unpriced.slug, "no_price", undefined],
    ]);
    // a SKU sent for a product that has no variants is refused too, and a sold-out variant is sold out
    const plain = await product({ name: "ساده" });
    expect((await place(me, [{ slug: plain.slug, sku: "X", quantity: 1 }])).body.items[0].reason).toBe("variant_not_found");
    await testDb.db.productVariant.updateMany({ where: { sku: "V1" }, data: { inventory: 0 } });
    expect((await place(me, [{ slug: withVariants.slug, sku: "V1", quantity: 1 }])).body.items[0].reason).toBe("sold_out");
  });

  it("an order total beyond the exact range is refused instead of being rounded", async () => {
    const big = await product({ name: "بسیار گران", fulfillment: "stocked", inventory: 5, priceToman: 999_999_999_999_999 });
    const me = await signIn();
    expect((await place(me, [{ slug: big.slug, quantity: 1 }])).body.order.totalToman).toBe(999_999_999_999_999);
    const r = await place(me, [{ slug: big.slug, quantity: 2 }]);
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("order_total_out_of_range");
  });

  it("made-to-order products can be ordered without stock; a unique piece only once per line", async () => {
    const made = await product({ name: "رانر سفارشی", fulfillment: "made_to_order", leadTimeDays: 21, inventory: null });
    const me = await signIn();
    const r = await place(me, [{ slug: made.slug, quantity: 3 }]);
    expect(r.status).toBe(201);
    expect(r.body.order.totalToman).toBe(3_000_000);
  });
});

describe("request rules", () => {
  it("needs a signed-in customer, the CSRF token and an allowed origin", async () => {
    const p = await product({ name: "اثر" });
    const me = await signIn();
    expect((await place(null, [{ slug: p.slug, quantity: 1 }])).status).toBe(401);
    expect((await place(me, [{ slug: p.slug, quantity: 1 }], {}, { csrf: "wrong" })).status).toBe(403);
    expect((await place(me, [{ slug: p.slug, quantity: 1 }], {}, { csrf: null })).status).toBe(403);
    expect((await place(me, [{ slug: p.slug, quantity: 1 }], {}, { origin: "https://evil.example" })).status).toBe(403);
    expect((await place(me, [{ slug: p.slug, quantity: 1 }], {}, { origin: null })).status).toBe(403);
    expect(await testDb.db.order.count()).toBe(0);
  });

  it("validates delivery details and the cart shape with field paths (no values echoed)", async () => {
    const p = await product({ name: "اثر" });
    const me = await signIn();
    const bad = await call("/api/v1/customer/orders", { method: "POST", as: me, body: { items: [{ slug: p.slug, quantity: 0 }], shipping: { ...SHIPPING, postalCode: "123", province: "جایی" }, requestId: "nope" } });
    expect(bad.status).toBe(422);
    const paths = bad.body.issues.map((i: any) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["items.0.quantity", "shipping.postalCode", "shipping.province", "requestId"]));
    expect(JSON.stringify(bad.body)).not.toContain("1459813176");
    // the same product and variant twice is one mistake, named by line
    const dup = await place(me, [{ slug: p.slug, quantity: 1 }, { slug: p.slug, quantity: 1 }]);
    expect(dup.status).toBe(422);
    expect(dup.body.issues.map((i: any) => [i.path, i.code])).toEqual([["items.1", "duplicate_line"]]);
    expect((await call("/api/v1/customer/orders", { method: "POST", as: me, body: { items: [], shipping: SHIPPING, requestId: requestId() } })).status).toBe(422);
  });

  it("is idempotent: a retry of the same attempt, even concurrent, returns the one order", async () => {
    const p = await product({ name: "اثر", fulfillment: "stocked", inventory: 9 });
    const me = await signIn();
    const id = requestId();
    const first = await place(me, [{ slug: p.slug, quantity: 1 }], { requestId: id });
    const again = await place(me, [{ slug: p.slug, quantity: 1 }], { requestId: id });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.order.number).toBe(first.body.order.number);

    const racing = requestId();
    const results = await Promise.all(Array.from({ length: 5 }, () => place(me, [{ slug: p.slug, quantity: 1 }], { requestId: racing })));
    expect(new Set(results.map((r) => r.body.order.number)).size).toBe(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await testDb.db.order.count()).toBe(2);

    // a retry returns the original order even after the product has since sold out: it was already placed
    await testDb.db.product.update({ where: { id: p.id }, data: { inventory: 0 } });
    expect((await place(me, [{ slug: p.slug, quantity: 1 }], { requestId: id })).body.order.number).toBe(first.body.order.number);
  });

  it("the same attempt id from another customer is a different order (the key is per customer)", async () => {
    const p = await product({ name: "اثر", fulfillment: "stocked", inventory: 9 });
    const a = await signIn();
    const b = await signIn("09351234567", "+989351234567");
    const id = requestId();
    const ra = await place(a, [{ slug: p.slug, quantity: 1 }], { requestId: id });
    const rb = await place(b, [{ slug: p.slug, quantity: 1 }], { requestId: id }, { ip: "198.51.100.9" });
    expect([ra.status, rb.status]).toEqual([201, 201]);
    expect(ra.body.order.number).not.toBe(rb.body.order.number);
    // and nobody can read the other's order
    expect((await call(`/api/v1/customer/orders/${ra.body.order.number}`, { as: b })).status).toBe(404);
  });

  it("caps open orders per customer, and refuses accounts that are being deleted", async () => {
    const p = await product({ name: "اثر", fulfillment: "stocked", inventory: 99 });
    const me = await signIn();
    for (let i = 0; i < 10; i++) expect((await place(me, [{ slug: p.slug, quantity: 1 }])).status).toBe(201);
    const over = await place(me, [{ slug: p.slug, quantity: 1 }]);
    expect(over.status).toBe(409);
    expect(over.body.error).toBe("too_many_open_orders");

    await testDb.db.order.updateMany({ data: { status: "delivered" } });
    await testDb.db.customer.update({ where: { id: me.id }, data: { status: "pending_deletion" } });
    const gone = await place(me, [{ slug: p.slug, quantity: 1 }]);
    expect([401, 403]).toContain(gone.status);
  });
});

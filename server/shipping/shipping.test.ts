/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted field by field */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { buildTestApp, call as adminCall, type Session, type TestApp } from "../testing/app";
import { shop, SHIPPING, type Customer } from "../testing/shop";
import { ShippingService } from "./service";
import type { ShippingProvider } from "./provider";

let testDb: TestDatabase;
let app: TestApp;
let categoryId: string;
let owner: Session;
let S: ReturnType<typeof shop>;

beforeAll(async () => void (testDb = await createTestDatabase()), 60_000);
afterAll(async () => testDb.close());
beforeEach(async () => {
  // Start from the fresh, unconfigured state: nothing is offered until the owner sets prices.
  app = await buildTestApp(testDb, { shipping: "none" });
  categoryId = (await app.repo.createCategory({ slug: "wall", name: "دیوارکوب" })).id;
  owner = await app.session("owner");
  S = shop(() => app, () => testDb, () => categoryId);
});

const FREE_OFF = { enabled: false, thresholdToman: null, methods: [] };
const FREE_3M = { enabled: true, thresholdToman: 3_000_000, methods: ["post"] };
const rate = (over: Record<string, unknown> = {}) => ({ provinces: [], cities: [], minWeightGrams: 0, maxWeightGrams: null, priceToman: 100_000, ...over });
const method = (m: string, over: Record<string, unknown> = {}) => ({ method: m, enabled: true, etaMinDays: null, etaMaxDays: null, note: null, rates: m === "pickup" ? [] : [rate()], ...over });
const getConfig = async () => (await adminCall(app, { path: "/api/v1/shipping/config", as: owner })).body.config;
async function putConfig(methods: unknown[], over: Record<string, unknown> = {}, as: Session | null = owner) {
  const current = as ? await getConfig().catch(() => null) : null;
  return adminCall(app, {
    method: "PUT",
    path: "/api/v1/shipping/config",
    as,
    body: { expectedVersion: current?.version ?? 1, defaultItemWeightGrams: 500, packagingWeightGrams: 0, freeShipping: FREE_OFF, methods, ...over },
  });
}
const quote = (as: Customer | null, items: unknown[], destination: unknown = null) =>
  S.call("/api/v1/customer/shipping/quote", { method: "POST", as, body: { items, destination } });
const fee = (r: Awaited<ReturnType<typeof quote>>, m: string) => r.body.quotes.find((q: any) => q.method === m);
const order = (as: Customer, items: unknown[], deliveryMethod: string, expectedFeeToman: number, shipping: unknown = SHIPPING, extra: Record<string, unknown> = {}) =>
  S.call("/api/v1/customer/orders", { method: "POST", as, body: { items, shipping, deliveryMethod, expectedFeeToman, requestId: crypto.randomUUID(), ...extra } });
const PICKUP = { recipientName: "علی رضایی", recipientPhone: "09121234567" };

describe("the owner's shipping table", () => {
  it("starts with every method off, so nothing is offered before the owner sets prices", async () => {
    const config = await getConfig();
    expect(config.methods.map((m: any) => [m.method, m.enabled])).toEqual([["post", false], ["tipax", false], ["local_courier", false], ["pickup", false]]);
    const p = await S.product({ name: "اثر" });
    const me = await S.signIn();
    const r = await quote(me, [{ slug: p.slug, quantity: 1 }], { province: "تهران", city: "تهران" });
    expect(r.status).toBe(200);
    expect(r.body.quotes.every((q: any) => q.available === false)).toBe(true);
    // ... and an order with any method is refused
    const refused = await order(me, [{ slug: p.slug, quantity: 1 }], "post", 0);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("delivery_unavailable");
    expect(await testDb.db.order.count()).toBe(0);
    expect((await testDb.db.product.findUniqueOrThrow({ where: { id: p.id } })).inventory).toBe(1); // nothing was reserved
  });

  it("saves and returns prices exactly, keeps rate order, and records an audit entry without prices or personal data", async () => {
    const saved = await putConfig(
      [method("post", { etaMinDays: 3, etaMaxDays: 7, rates: [rate({ provinces: ["تهران"], priceToman: 85_000 }), rate({ priceToman: 140_000, minWeightGrams: 0, maxWeightGrams: 2000 })] }), method("pickup", { note: "گالری، ساعت ۱۰ تا ۱۸" })],
      { defaultItemWeightGrams: 650, packagingWeightGrams: 200, freeShipping: { enabled: true, thresholdToman: 5_000_000, methods: ["post"] } },
    );
    expect(saved.status).toBe(200);
    expect(saved.body.config).toMatchObject({ version: 2, defaultItemWeightGrams: 650, packagingWeightGrams: 200 });
    const post = saved.body.config.methods.find((m: any) => m.method === "post");
    expect(post).toMatchObject({ enabled: true, etaMinDays: 3, etaMaxDays: 7 });
    expect(saved.body.config.freeShipping).toEqual({ enabled: true, thresholdToman: 5_000_000, methods: ["post"] });
    expect(post.rates.map((r: any) => r.priceToman)).toEqual([85_000, 140_000]);
    expect(saved.body.config.methods.find((m: any) => m.method === "pickup").note).toBe("گالری، ساعت ۱۰ تا ۱۸");
    const log = await testDb.db.auditLog.findFirstOrThrow({ where: { action: "shipping.config" } });
    expect(log.actorEmail).toBe("owner@example.test");
    expect(JSON.stringify(log.detail)).not.toContain("85000");
  });

  it("only the owner can read or change it", async () => {
    for (const role of ["editor", "support", "viewer"] as const) {
      const as = await app.session(role);
      expect((await adminCall(app, { path: "/api/v1/shipping/config", as })).status, role).toBe(403);
      expect((await putConfig([method("pickup")], {}, as)).status, role).toBe(403);
    }
    expect((await adminCall(app, { path: "/api/v1/shipping/config", as: null })).status).toBe(401);
  });

  it("explains invalid tables field by field and changes nothing", async () => {
    const before = await getConfig();
    const bad = await putConfig([method("post", { rates: [] })]);
    expect(bad.status).toBe(422);
    expect(bad.body.issues.map((i: any) => i.path)).toContain("methods.0.rates");
    const overlap = await putConfig([method("post", { rates: [rate({ provinces: ["تهران"], maxWeightGrams: 1000 }), rate({ provinces: ["تهران"], minWeightGrams: 500 })] })]);
    expect(overlap.status).toBe(422);
    expect(await getConfig()).toEqual(before);
  });

  it("refuses a save made from an out-of-date screen and hands back the current table", async () => {
    const first = await getConfig();
    expect((await putConfig([method("pickup")], { expectedVersion: first.version })).status).toBe(200);
    const stale = await adminCall(app, { method: "PUT", path: "/api/v1/shipping/config", as: owner, body: { expectedVersion: first.version, defaultItemWeightGrams: 500, packagingWeightGrams: 0, freeShipping: FREE_OFF, methods: [method("tipax")] } });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("shipping_config_changed");
    expect(stale.body.detail.config.version).toBe(first.version + 1);
    expect(stale.body.detail.config.methods.find((m: any) => m.method === "tipax").enabled).toBe(false);
  });
});

describe("quotes by destination, weight and method", () => {
  beforeEach(async () => {
    expect(
      (
        await putConfig(
          [
            method("post", {
              etaMinDays: 3,
              etaMaxDays: 7,
              rates: [
                rate({ priceToman: 150_000 }),
                rate({ provinces: ["تهران"], priceToman: 90_000, maxWeightGrams: 2000 }),
                rate({ provinces: ["تهران"], priceToman: 140_000, minWeightGrams: 2001 }),
                rate({ provinces: ["البرز"], cities: ["کرج"], priceToman: 70_000 }),
              ],
            }),
            method("tipax", { rates: [rate({ provinces: ["تهران"], priceToman: 120_000, maxWeightGrams: 5000 })] }),
            method("local_courier", { rates: [rate({ provinces: ["تهران"], cities: ["تهران"], priceToman: 60_000 })], etaMinDays: 1, etaMaxDays: 1 }),
            method("pickup", { note: "تحویل در گالری" }),
          ],
          { defaultItemWeightGrams: 500, packagingWeightGrams: 100, freeShipping: FREE_3M },
        )
      ).status,
    ).toBe(200);
  });

  it("is for signed-in customers only", async () => {
    const p = await S.product({ name: "اثر" });
    expect((await quote(null, [{ slug: p.slug, quantity: 1 }])).status).toBe(401);
  });

  it("with no address offers only pickup; with an address prices each method by destination", async () => {
    const p = await S.product({ name: "اثر", priceToman: 1_000_000 });
    const me = await S.signIn();
    const items = [{ slug: p.slug, quantity: 1 }];
    const bare = await quote(me, items);
    expect(bare.body).toMatchObject({ subtotalToman: 1_000_000 });
    expect(fee(bare, "pickup")).toMatchObject({ available: true, feeToman: 0, note: "تحویل در گالری" });
    expect(fee(bare, "post")).toMatchObject({ available: false, reason: "address_required" });

    const teh = await quote(me, items, { province: "تهران", city: "تهران" });
    expect(fee(teh, "post")).toMatchObject({ available: true, feeToman: 90_000, free: false, etaMinDays: 3, etaMaxDays: 7 });
    expect(fee(teh, "tipax")).toMatchObject({ feeToman: 120_000 });
    expect(fee(teh, "local_courier")).toMatchObject({ feeToman: 60_000, etaMinDays: 1 });

    const shiraz = await quote(me, items, { province: "فارس", city: "شیراز" });
    expect(fee(shiraz, "post")).toMatchObject({ feeToman: 150_000 }); // the "anywhere" row
    expect(fee(shiraz, "tipax")).toMatchObject({ available: false, reason: "not_served" });
    expect(fee(shiraz, "local_courier")).toMatchObject({ available: false, reason: "not_served" });

    const karaj = await quote(me, items, { province: "البرز", city: "كرج" }); // Arabic letters still match
    expect(fee(karaj, "post")).toMatchObject({ feeToman: 70_000 });
  });

  it("prices by the real weight: product weight, the shop default, and packaging", async () => {
    const heavy = await S.product({ name: "سنگین", fulfillment: "stocked", inventory: 10, weightGrams: 1000, priceToman: 100_000 });
    const plain = await S.product({ name: "ساده", fulfillment: "stocked", inventory: 10, priceToman: 100_000 }); // default 500 g
    const me = await S.signIn();
    const dest = { province: "تهران", city: "تهران" };
    // 1 x 1000 + packaging 100 = 1100 g -> the light band
    const one = await quote(me, [{ slug: heavy.slug, quantity: 1 }], dest);
    expect(one.body.weightGrams).toBe(1100);
    expect(fee(one, "post").feeToman).toBe(90_000);
    // 2 x 1000 + 1 x 500 + 100 = 2600 g -> the heavy band
    const many = await quote(me, [{ slug: heavy.slug, quantity: 2 }, { slug: plain.slug, quantity: 1 }], dest);
    expect(many.body.weightGrams).toBe(2600);
    expect(fee(many, "post").feeToman).toBe(140_000);
    // 11 x 500 + 100 = 5600 g: heavier than tipax prices go
    const huge = await quote(me, [{ slug: plain.slug, quantity: 10 }, { slug: heavy.slug, quantity: 1 }], dest);
    expect(huge.body.weightGrams).toBe(10 * 500 + 1000 + 100);
    expect(fee(huge, "tipax")).toMatchObject({ available: false, reason: "not_served" });
  });

  it("waives the post fee at the free-shipping threshold, to the Toman", async () => {
    const just = await S.product({ name: "کمی کمتر", priceToman: 2_999_999 });
    const exact = await S.product({ name: "دقیقاً", priceToman: 3_000_000 });
    const me = await S.signIn();
    const dest = { province: "تهران", city: "تهران" };
    expect(fee(await quote(me, [{ slug: just.slug, quantity: 1 }], dest), "post")).toMatchObject({ feeToman: 90_000, free: false });
    expect(fee(await quote(me, [{ slug: exact.slug, quantity: 1 }], dest), "post")).toMatchObject({ feeToman: 0, free: true });
    expect(fee(await quote(me, [{ slug: exact.slug, quantity: 1 }], dest), "tipax").feeToman).toBe(120_000); // tipax has no threshold
  });

  it("refuses to price a cart whose lines cannot be ordered, and validates the destination", async () => {
    const me = await S.signIn();
    const gone = await quote(me, [{ slug: "nope", quantity: 1 }], { province: "تهران", city: "تهران" });
    expect(gone.status).toBe(409);
    expect(gone.body.items[0]).toMatchObject({ slug: "nope", reason: "not_found" });
    const p = await S.product({ name: "اثر" });
    expect((await quote(me, [{ slug: p.slug, quantity: 1 }], { province: "جایی", city: "تهران" })).status).toBe(422);
  });
});

describe("ordering with delivery", () => {
  beforeEach(async () => {
    await putConfig(
      [
        method("post", { etaMinDays: 3, etaMaxDays: 7, rates: [rate({ provinces: ["تهران"], priceToman: 90_000 })] }),
        method("pickup", { note: "تحویل در گالری" }),
      ],
      { freeShipping: FREE_3M },
    );
  });

  it("stores the method, the server's fee, the frozen quote, and a total of goods + delivery", async () => {
    const p = await S.product({ name: "اثر", priceToman: 1_000_000 });
    const me = await S.signIn();
    const r = await order(me, [{ slug: p.slug, quantity: 1 }], "post", 90_000);
    expect(r.status).toBe(201);
    expect(r.body.order).toMatchObject({
      status: "pending", subtotalToman: 1_000_000, shippingFeeToman: 90_000, totalToman: 1_090_000,
      delivery: { method: "post", free: false, etaMinDays: 3, etaMaxDays: 7 },
      shipping: { province: "تهران", city: "تهران" },
    });
    const row = await testDb.db.order.findFirstOrThrow({ where: { number: r.body.order.number } });
    expect([row.totalToman, row.subtotalToman, row.shippingFeeToman, row.deliveryMethod]).toEqual([1_090_000n, 1_000_000n, 90_000n, "post"]);
    expect(row.deliveryDetails).toMatchObject({ weightGrams: 500, free: false });
    // the customer's own history shows the same
    const again = await S.call(`/api/v1/customer/orders/${r.body.order.number}`, { as: me });
    expect(again.body.order).toMatchObject({ shippingFeeToman: 90_000, totalToman: 1_090_000 });
  });

  it("free shipping: fee 0, flagged free, total is just the goods", async () => {
    const p = await S.product({ name: "گران", priceToman: 3_500_000 });
    const me = await S.signIn();
    const r = await order(me, [{ slug: p.slug, quantity: 1 }], "post", 0);
    expect(r.status).toBe(201);
    expect(r.body.order).toMatchObject({ shippingFeeToman: 0, totalToman: 3_500_000, delivery: { method: "post", free: true } });
  });

  it("never trusts the fee the browser claims: a different fee refuses the order and reports the real prices", async () => {
    const p = await S.product({ name: "اثر", priceToman: 1_000_000 });
    const me = await S.signIn();
    for (const claimed of [0, 1, 89_999, 90_001]) {
      const r = await order(me, [{ slug: p.slug, quantity: 1 }], "post", claimed);
      expect(r.status, String(claimed)).toBe(409);
      expect(r.body.error).toBe("delivery_fee_changed");
      expect(r.body.quotes.find((q: any) => q.method === "post").feeToman).toBe(90_000);
    }
    expect(await testDb.db.order.count()).toBe(0);
    expect((await testDb.db.product.findUniqueOrThrow({ where: { id: p.id } })).inventory).toBe(1); // nothing reserved by the refusals
    // a total or fee sent as a separate field is not accepted at all
    expect((await order(me, [{ slug: p.slug, quantity: 1 }], "post", 90_000, SHIPPING, { totalToman: 1 })).status).toBe(422);
    expect((await order(me, [{ slug: p.slug, quantity: 1 }], "post", 90_000, SHIPPING, { shippingFeeToman: 0 })).status).toBe(422);
  });

  it("refuses a method that is off or does not serve the address", async () => {
    const p = await S.product({ name: "اثر" });
    const me = await S.signIn();
    expect((await order(me, [{ slug: p.slug, quantity: 1 }], "tipax", 0)).body.error).toBe("delivery_unavailable");
    expect((await order(me, [{ slug: p.slug, quantity: 1 }], "post", 0, { ...SHIPPING, province: "فارس", city: "شیراز" })).body.error).toBe("delivery_unavailable");
    expect((await order(me, [{ slug: p.slug, quantity: 1 }], "teleport", 0)).status).toBe(422);
    expect(await testDb.db.order.count()).toBe(0);
  });

  it("validates the address for carried deliveries, field by field", async () => {
    const p = await S.product({ name: "اثر" });
    const me = await S.signIn();
    const bad = await order(me, [{ slug: p.slug, quantity: 1 }], "post", 90_000, { ...SHIPPING, postalCode: "123", street: "ab" });
    expect(bad.status).toBe(422);
    expect(bad.body.issues.map((i: any) => i.path)).toEqual(expect.arrayContaining(["shipping.postalCode", "shipping.street"]));
    expect((await order(me, [{ slug: p.slug, quantity: 1 }], "post", 90_000, PICKUP)).status).toBe(422); // no address at all
  });

  it("pickup needs only a name and a phone, costs nothing and keeps no address", async () => {
    const p = await S.product({ name: "اثر", priceToman: 700_000 });
    const me = await S.signIn();
    const r = await order(me, [{ slug: p.slug, quantity: 1 }], "pickup", 0, PICKUP);
    expect(r.status).toBe(201);
    expect(r.body.order).toMatchObject({ totalToman: 700_000, shippingFeeToman: 0, delivery: { method: "pickup", note: "تحویل در گالری" } });
    expect(r.body.order.shipping).toMatchObject({ recipientName: "علی رضایی", province: "", city: "", street: null, postalCode: null });
    // an address sent with a pickup order is not accepted (nothing extra is stored about the customer)
    const p2 = await S.product({ name: "دومی" });
    expect((await order(me, [{ slug: p2.slug, quantity: 1 }], "pickup", 0, SHIPPING)).status).toBe(422);
  });

  it("a retry of the same attempt returns the same order even if prices changed since", async () => {
    const p = await S.product({ name: "اثر", priceToman: 1_000_000 });
    const me = await S.signIn();
    const requestId = crypto.randomUUID();
    const first = await order(me, [{ slug: p.slug, quantity: 1 }], "post", 90_000, SHIPPING, { requestId });
    expect(first.status).toBe(201);
    await putConfig([method("post", { rates: [rate({ provinces: ["تهران"], priceToman: 500_000 })] })]);
    const retry = await order(me, [{ slug: p.slug, quantity: 1 }], "post", 90_000, SHIPPING, { requestId });
    expect(retry.status).toBe(200);
    expect(retry.body.order.number).toBe(first.body.order.number);
    expect(retry.body.order.shippingFeeToman).toBe(90_000);
    expect(await testDb.db.order.count()).toBe(1);
  });

  it("changing the owner's prices later never changes an order already placed", async () => {
    const p = await S.product({ name: "اثر", priceToman: 1_000_000 });
    const me = await S.signIn();
    const placed = await order(me, [{ slug: p.slug, quantity: 1 }], "post", 90_000);
    await putConfig([method("post", { rates: [rate({ provinces: ["تهران"], priceToman: 999_000 })] })]);
    const after = await S.call(`/api/v1/customer/orders/${placed.body.order.number}`, { as: me });
    expect(after.body.order).toMatchObject({ shippingFeeToman: 90_000, totalToman: 1_090_000 });
    const staff = await adminCall(app, { path: `/api/v1/orders/${placed.body.order.number}`, as: owner });
    expect(staff.body.order).toMatchObject({ subtotalToman: 1_000_000, shippingFeeToman: 90_000, totalToman: 1_090_000, delivery: { method: "post", weightGrams: 500 } });
  });

  it("an order from before shipping existed reads as 'no method', fee 0, total unchanged", async () => {
    const p = await S.product({ name: "اثر" });
    const me = await S.signIn();
    const customerId = me.id;
    const vendorId = (await testDb.db.vendor.findFirstOrThrow()).id;
    const old = await testDb.db.order.create({
      data: {
        customerId, totalToman: 250_000n, shipping: { recipientName: "علی", province: "تهران", city: "تهران" }, placedAt: new Date(),
        items: { create: [{ productId: p.id, vendorId, titleSnapshot: "قدیمی", unitPriceToman: 250_000n, quantity: 1 }] },
        statusHistory: { create: { toStatus: "pending", actorType: "system" } },
      },
    });
    // the migration sets subtotal = total for old rows; a row created without it keeps the column default
    await testDb.db.order.update({ where: { id: old.id }, data: { subtotalToman: 250_000n } });
    const r = await S.call(`/api/v1/customer/orders/${old.number}`, { as: me });
    expect(r.body.order).toMatchObject({ totalToman: 250_000, subtotalToman: 250_000, shippingFeeToman: 0, delivery: { method: null }, shipment: null });
    const staff = await adminCall(app, { path: `/api/v1/orders/${old.number}`, as: owner });
    expect(staff.body.order.delivery.method).toBeNull();
  });
});

describe("carrier and tracking", () => {
  let me: Customer;
  let number: number;
  const move = (to: string, expectedStatus: string, extra: Record<string, unknown> = {}) =>
    adminCall(app, { method: "POST", path: `/api/v1/orders/${number}/transition`, as: owner, body: { to, expectedStatus, ...extra } });
  const setShipment = (body: unknown, as: Session | null = owner) => adminCall(app, { method: "PUT", path: `/api/v1/orders/${number}/shipment`, as, body });

  beforeEach(async () => {
    await putConfig([method("post", { rates: [rate({ priceToman: 50_000 })] }), method("pickup")]);
    const p = await S.product({ name: "اثر", priceToman: 1_000_000 });
    me = await S.signIn();
    number = (await order(me, [{ slug: p.slug, quantity: 1 }], "post", 50_000)).body.order.number;
  });

  it("is not allowed before the order is confirmed", async () => {
    const r = await setShipment({ carrier: "post", trackingCode: "123" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("shipment_not_allowed");
    expect(await testDb.db.orderShipment.count()).toBe(0);
  });

  it("is saved together with the move to 'shipped' and shown to the customer", async () => {
    expect((await move("confirmed", "pending")).status).toBe(200);
    expect((await move("preparing", "confirmed")).status).toBe(200);
    const shipped = await move("shipped", "preparing", { shipment: { carrier: "post", trackingCode: "  ۲۴۱۳۵۸۶۷۹۱۲۳۴۵۶۷۸۹۰۱۲  " } });
    expect(shipped.status).toBe(200);
    expect(shipped.body.order.status).toBe("shipped");
    expect(shipped.body.order.shipment).toMatchObject({ carrier: "post", carrierName: null, trackingCode: "241358679123456789012", updatedBy: "owner@example.test" });
    const seen = await S.call(`/api/v1/customer/orders/${number}`, { as: me });
    expect(seen.body.order.shipment).toMatchObject({ carrier: "post", trackingCode: "241358679123456789012", trackingUrl: null });
    expect(Object.keys(seen.body.order.shipment).sort()).toEqual(["carrier", "carrierName", "trackingCode", "trackingUrl", "updatedAt"]); // no staff e-mail for customers
  });

  it("can be corrected later, including after delivery, and each change is audited without the code", async () => {
    await move("confirmed", "pending");
    expect((await setShipment({ carrier: "tipax", trackingCode: "AB-1" })).status).toBe(200);
    expect((await setShipment({ carrier: "other", carrierName: "پیک آزاد", trackingCode: "AB-2" })).body.order.shipment).toMatchObject({ carrier: "other", carrierName: "پیک آزاد", trackingCode: "AB-2" });
    await move("preparing", "confirmed");
    await move("shipped", "preparing");
    await move("delivered", "shipped");
    expect((await setShipment({ carrier: "tipax", trackingCode: "AB-3" })).status).toBe(200);
    expect(await testDb.db.orderShipment.count()).toBe(1);
    const logs = await testDb.db.auditLog.findMany({ where: { action: "order.shipment" } });
    expect(logs).toHaveLength(3);
    expect(JSON.stringify(logs.map((l) => l.detail))).not.toMatch(/AB-/);
    expect(logs[0]!.detail).toMatchObject({ number, carrier: "tipax", hasTracking: true });
  });

  it("validates the input: other needs a name, codes are plain, only the move to 'shipped' takes a shipment", async () => {
    await move("confirmed", "pending");
    expect((await setShipment({ carrier: "other", trackingCode: "1" })).status).toBe(422);
    expect((await setShipment({ carrier: "post", trackingCode: "<script>alert(1)</script>" })).status).toBe(422);
    expect((await setShipment({ carrier: "teleport" })).status).toBe(422);
    expect((await setShipment({ carrier: "post", trackingCode: "x".repeat(65) })).status).toBe(422);
    expect((await setShipment({ carrier: "post", extra: 1 })).status).toBe(422);
    expect((await move("preparing", "confirmed", { shipment: { carrier: "post" } })).status).toBe(422);
    expect((await setShipment({ carrier: "post" })).status).toBe(200); // a carrier without a code is fine
    expect((await adminCall(app, { path: `/api/v1/orders/${number}`, as: owner })).body.order.shipment.trackingCode).toBeNull();
  });

  it("needs permission to change (support may, editor and viewer may not)", async () => {
    await move("confirmed", "pending");
    expect((await setShipment({ carrier: "post" }, await app.session("support"))).status).toBe(200);
    expect((await setShipment({ carrier: "post" }, await app.session("editor"))).status).toBe(403);
    expect((await setShipment({ carrier: "post" }, await app.session("viewer"))).status).toBe(403);
    expect((await setShipment({ carrier: "post" }, null)).status).toBe(401);
  });

  it("is part of the order data a customer can export", async () => {
    await move("confirmed", "pending");
    await setShipment({ carrier: "post", trackingCode: "ZZ-9" });
    const exported = await testDb.db.order.findFirstOrThrow({ where: { number }, include: { shipment: true } });
    expect(exported.shipment?.trackingCode).toBe("ZZ-9");
    const core = await app.platform.accountStore.gatherExport(me.id);
    expect(core?.orders[0]).toMatchObject({ shippingFeeToman: 50_000, delivery: { method: "post" }, shipment: { trackingCode: "ZZ-9" } });
  });
});

describe("providers: one rate table today, other sources later", () => {
  const dest = { province: "تهران", city: "تهران" };
  const line = [{ quantity: 1, weightGrams: 500 }];
  const fake = (id: string, methods: ShippingProvider["methods"], price: number, fails = false): ShippingProvider => ({
    id,
    methods,
    async quote() {
      if (fails) throw new Error("carrier API is down");
      return methods.map((m) => ({ method: m, available: true as const, feeToman: price, free: false, etaMinDays: null, etaMaxDays: null, note: null, rateId: null }));
    },
  });

  it("the first provider that lists a method answers for it; the rest are not asked about it", async () => {
    const service = new ShippingService([fake("a", ["tipax"], 111), fake("b", ["tipax", "post"], 222)], app.platform.shippingConfig);
    const r = await service.quote({ destination: dest, lines: line, subtotalToman: 1000 });
    expect(r.quotes.find((q) => q.method === "tipax")).toMatchObject({ feeToman: 111 });
    expect(r.quotes.find((q) => q.method === "post")).toMatchObject({ feeToman: 222 });
    expect(r.quotes.find((q) => q.method === "pickup")).toMatchObject({ available: false });
  });

  it("a provider that fails only takes ITS methods away; the rest of the checkout keeps working", async () => {
    const events: string[] = [];
    const service = new ShippingService([fake("broken", ["tipax"], 1, true), fake("ok", ["post"], 5)], app.platform.shippingConfig, (e) => void events.push(e));
    const r = await service.quote({ destination: dest, lines: line, subtotalToman: 1000 });
    expect(r.quotes.find((q) => q.method === "tipax")).toMatchObject({ available: false });
    expect(r.quotes.find((q) => q.method === "post")).toMatchObject({ available: true, feeToman: 5 });
    expect(events).toEqual(["shipping.provider_failed"]);
  });

  it("builds tracking links only from providers that know one", () => {
    const withUrl: ShippingProvider = { ...fake("x", ["post"], 0), trackingUrl: (carrier, code) => (carrier === "post" ? `https://tracking.example.test/${encodeURIComponent(code)}` : null) };
    const service = new ShippingService([fake("plain", ["tipax"], 0), withUrl], app.platform.shippingConfig);
    expect(service.trackingUrl("post", "A B")).toBe("https://tracking.example.test/A%20B");
    expect(service.trackingUrl("tipax", "1")).toBeNull();
  });
});

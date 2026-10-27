/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted field by field */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { buildTestApp, call as adminCall, STORE_ORIGIN, type Session, type TestApp } from "../testing/app";
import { shop, SHIPPING, type Customer } from "../testing/shop";

let testDb: TestDatabase;
let app: TestApp;
let owner: Session;
let S: ReturnType<typeof shop>;
let me: Customer;

beforeAll(async () => void (testDb = await createTestDatabase()), 60_000);
afterAll(async () => testDb.close());
beforeEach(async () => {
  app = await buildTestApp(testDb, { shipping: "none" });
  const category = (await app.repo.createCategory({ slug: "wall", name: "دیوارکوب" })).id;
  owner = await app.session("owner");
  S = shop(() => app, () => testDb, () => category);
  me = await S.signIn();
});

const rate = (over: Record<string, unknown> = {}) => ({ provinces: [], cities: [], minWeightGrams: 0, maxWeightGrams: null, priceToman: 90_000, ...over });
const method = (m: string, over: Record<string, unknown> = {}) => ({ method: m, enabled: true, etaMinDays: null, etaMaxDays: null, note: null, rates: m === "pickup" ? [] : [rate()], ...over });
const OFF = { enabled: false, thresholdToman: null, methods: [] };
const getConfig = async () => (await adminCall(app, { path: "/api/v1/shipping/config", as: owner })).body.config;
async function put(freeShipping: unknown, methods: unknown[] = [method("post"), method("tipax"), method("pickup")], as: Session | null = owner) {
  const version = (await getConfig()).version;
  return adminCall(app, { method: "PUT", path: "/api/v1/shipping/config", as, body: { expectedVersion: version, defaultItemWeightGrams: 500, packagingWeightGrams: 0, freeShipping, methods } });
}
const TEHRAN = { province: "تهران", city: "تهران" };
const quote = (items: unknown[], destination: unknown = TEHRAN) => S.call("/api/v1/customer/shipping/quote", { method: "POST", as: me, body: { items, destination } });
const q = (r: { body: any }, m: string) => r.body.quotes.find((x: any) => x.method === m);
const order = (items: unknown[], deliveryMethod: string, expectedFeeToman: unknown, shipping: unknown = SHIPPING, extra: Record<string, unknown> = {}) =>
  S.call("/api/v1/customer/orders", { method: "POST", as: me, body: { items, shipping, deliveryMethod, expectedFeeToman, requestId: crypto.randomUUID(), ...extra } });
const PICKUP = { recipientName: "علی رضایی", recipientPhone: "09121234567" };
const publicPolicy = (headers: Record<string, string> = {}) =>
  app.customerApi(new Request("https://api.example.test/api/v1/public/shipping/free-shipping", { headers: { origin: STORE_ORIGIN, "x-forwarded-for": "198.51.100.9", ...headers } }));

describe("free shipping settings (admin, no code changes)", () => {
  it("is off by default: nothing is free until the owner turns it on", async () => {
    expect((await getConfig()).freeShipping).toEqual(OFF);
    expect((await put(OFF)).status).toBe(200);
    const p = await S.product({ name: "گران", priceToman: 50_000_000 });
    const r = await quote([{ slug: p.slug, quantity: 1 }]);
    expect(q(r, "post")).toMatchObject({ feeToman: 90_000, free: false });
    expect(r.body.freeShipping).toEqual({ enabled: false, thresholdToman: null, methods: [], remainingToman: null, qualified: false });
  });

  it("saves enable / threshold / eligible methods exactly and can change them again at any time", async () => {
    const on = await put({ enabled: true, thresholdToman: 3_000_000, methods: ["post", "tipax"] });
    expect(on.status).toBe(200);
    expect(on.body.config.freeShipping).toEqual({ enabled: true, thresholdToman: 3_000_000, methods: ["post", "tipax"] });
    const changed = await put({ enabled: true, thresholdToman: 1_234_567, methods: ["post"] });
    expect(changed.body.config.freeShipping).toEqual({ enabled: true, thresholdToman: 1_234_567, methods: ["post"] });
    const off = await put({ enabled: false, thresholdToman: 1_234_567, methods: ["post"] }); // switching off keeps the numbers for later
    expect(off.body.config.freeShipping).toEqual({ enabled: false, thresholdToman: 1_234_567, methods: ["post"] });
    expect(await testDb.db.auditLog.count({ where: { action: "shipping.config" } })).toBe(3);
  });

  it("explains invalid settings and saves nothing", async () => {
    const before = await getConfig();
    const cases: Array<[unknown, string]> = [
      [{ enabled: true, thresholdToman: null, methods: ["post"] }, "free_threshold_required"],
      [{ enabled: true, thresholdToman: 0, methods: ["post"] }, "free_threshold_required"],
      [{ enabled: true, thresholdToman: 1_000_000, methods: [] }, "free_methods_required"],
      [{ enabled: true, thresholdToman: 1_000_000, methods: ["pickup"] }, "pickup_is_always_free"],
      [{ enabled: true, thresholdToman: 1_000_000, methods: ["post", "post"] }, "duplicate_method"],
    ];
    for (const [policy, code] of cases) {
      const r = await put(policy);
      expect(r.status, code).toBe(422);
      expect(r.body.issues.map((i: any) => i.code)).toContain(code);
    }
    for (const threshold of [1.5, -1, 10 ** 16, "3000000"]) expect((await put({ enabled: true, thresholdToman: threshold, methods: ["post"] })).status, String(threshold)).toBe(422);
    expect((await put({ enabled: true, thresholdToman: 5, methods: ["teleport"] })).status).toBe(422);
    expect((await put({ enabled: true, thresholdToman: 5, methods: ["post"], bonus: true })).status).toBe(422);
    expect(await getConfig()).toEqual(before);
  });

  it("only the owner changes it", async () => {
    for (const role of ["editor", "support", "viewer"] as const) expect((await put({ enabled: true, thresholdToman: 1, methods: ["post"] }, undefined, await app.session(role))).status, role).toBe(403);
  });
});

describe("free shipping at the threshold (server-side, to the Toman)", () => {
  beforeEach(async () => {
    expect((await put({ enabled: true, thresholdToman: 3_000_000, methods: ["post"] })).status).toBe(200);
  });

  it("the fee is waived at exactly the threshold and not a Toman before; the quote says how much more to buy", async () => {
    const below = await S.product({ name: "کمی کمتر", priceToman: 2_999_999 });
    const at = await S.product({ name: "دقیقاً", priceToman: 3_000_000 });
    const r1 = await quote([{ slug: below.slug, quantity: 1 }]);
    expect(q(r1, "post")).toMatchObject({ feeToman: 90_000, free: false });
    expect(r1.body.freeShipping).toMatchObject({ enabled: true, thresholdToman: 3_000_000, remainingToman: 1, qualified: false });
    const r2 = await quote([{ slug: at.slug, quantity: 1 }]);
    expect(q(r2, "post")).toMatchObject({ feeToman: 0, free: true });
    expect(r2.body.freeShipping).toMatchObject({ remainingToman: 0, qualified: true });
  });

  it("counts the items only (not the fee), summed over lines and quantities", async () => {
    const a = await S.product({ name: "الف الف", fulfillment: "stocked", inventory: 9, priceToman: 800_000 });
    const b = await S.product({ name: "ب ب ب", fulfillment: "stocked", inventory: 9, priceToman: 700_000 });
    const r = await quote([{ slug: a.slug, quantity: 2 }, { slug: b.slug, quantity: 2 }]); // 3,000,000
    expect(r.body.subtotalToman).toBe(3_000_000);
    expect(q(r, "post")).toMatchObject({ free: true, feeToman: 0 });
    const less = await quote([{ slug: a.slug, quantity: 2 }, { slug: b.slug, quantity: 1 }]); // 2,300,000
    expect(less.body.freeShipping.remainingToman).toBe(700_000);
    expect(q(less, "post").feeToman).toBe(90_000);
  });

  it("only the methods the owner chose are free; the others keep their price", async () => {
    const p = await S.product({ name: "گران", priceToman: 9_000_000 });
    const r = await quote([{ slug: p.slug, quantity: 1 }]);
    expect(q(r, "post")).toMatchObject({ feeToman: 0, free: true });
    expect(q(r, "tipax")).toMatchObject({ feeToman: 90_000, free: false });
    expect(q(r, "pickup")).toMatchObject({ feeToman: 0, free: false }); // pickup is simply without cost
  });

  it("an unserved destination stays unavailable even when the cart qualifies", async () => {
    await put({ enabled: true, thresholdToman: 3_000_000, methods: ["post"] }, [method("post", { rates: [rate({ provinces: ["تهران"] })] }), method("pickup")]);
    const p = await S.product({ name: "گران", priceToman: 9_000_000 });
    const r = await quote([{ slug: p.slug, quantity: 1 }], { province: "فارس", city: "شیراز" });
    expect(q(r, "post")).toMatchObject({ available: false, reason: "not_served" });
  });

  it("changing the threshold (or switching it off) applies to the very next quote; orders already placed keep their fee", async () => {
    const p = await S.product({ name: "میانه", fulfillment: "stocked", inventory: 9, priceToman: 2_000_000 });
    const lines = [{ slug: p.slug, quantity: 1 }];
    expect(q(await quote(lines), "post")).toMatchObject({ feeToman: 90_000 });
    const paid = await order(lines, "post", 90_000);
    expect(paid.status).toBe(201);

    await put({ enabled: true, thresholdToman: 2_000_000, methods: ["post"] }); // lowered to exactly this cart
    const r = await quote(lines);
    expect(q(r, "post")).toMatchObject({ feeToman: 0, free: true });
    expect(r.body.freeShipping).toMatchObject({ thresholdToman: 2_000_000, remainingToman: 0 });
    const free = await order(lines, "post", 0);
    expect(free.status).toBe(201);
    expect(free.body.order).toMatchObject({ shippingFeeToman: 0, totalToman: 2_000_000, delivery: { free: true } });

    await put({ enabled: false, thresholdToman: 2_000_000, methods: ["post"] });
    expect(q(await quote(lines), "post")).toMatchObject({ feeToman: 90_000, free: false });
    // the two orders keep what they were charged
    expect((await S.call(`/api/v1/customer/orders/${paid.body.order.number}`, { as: me })).body.order).toMatchObject({ shippingFeeToman: 90_000, totalToman: 2_090_000, delivery: { free: false } });
    expect((await S.call(`/api/v1/customer/orders/${free.body.order.number}`, { as: me })).body.order).toMatchObject({ shippingFeeToman: 0, totalToman: 2_000_000 });
  });
});

describe("the public promise (for the cart page)", () => {
  it("is readable without signing in, holds only the policy, and follows the owner's settings", async () => {
    const off = await publicPolicy();
    expect(off.status).toBe(200);
    expect((await off.json()).freeShipping).toEqual({ enabled: false, thresholdToman: null, methods: [], remainingToman: null, qualified: false });
    expect(off.headers.get("access-control-allow-origin")).toBe("*"); // public, credentialless: no cookie can ride along
    expect(off.headers.get("access-control-allow-credentials")).toBeNull();

    await put({ enabled: true, thresholdToman: 2_500_000, methods: ["post", "local_courier"] });
    const on = await (await publicPolicy()).json();
    expect(on.freeShipping).toMatchObject({ enabled: true, thresholdToman: 2_500_000, methods: ["post", "local_courier"], remainingToman: 2_500_000 });
    // nothing else leaks: no rates, prices, notes or version
    expect(JSON.stringify(on)).not.toMatch(/priceToman|rates|version|note/);
  });
});

describe("price manipulation", () => {
  beforeEach(async () => {
    await put({ enabled: true, thresholdToman: 3_000_000, methods: ["post"] }, [method("post", { rates: [rate({ priceToman: 90_000 })] }), method("tipax", { rates: [rate({ priceToman: 120_000 })] }), method("pickup")]);
  });

  it("a fee the cart does not qualify for is refused: claiming 'free' below the threshold", async () => {
    const p = await S.product({ name: "ارزان", priceToman: 1_000_000 });
    for (const claimed of [0, 1, 89_999, 90_001]) {
      const r = await order([{ slug: p.slug, quantity: 1 }], "post", claimed);
      expect(r.status, String(claimed)).toBe(409);
      expect(r.body.error).toBe("delivery_fee_changed");
      expect(q({ body: r.body }, "post").feeToman).toBe(90_000);
    }
    expect(await testDb.db.order.count()).toBe(0);
    expect((await testDb.db.product.findUniqueOrThrow({ where: { id: p.id } })).inventory).toBe(1);
  });

  it("claiming a price when the cart IS free is refused too, and a method that is not free cannot borrow the policy", async () => {
    const p = await S.product({ name: "گران", fulfillment: "stocked", inventory: 5, priceToman: 3_500_000 });
    const lines = [{ slug: p.slug, quantity: 1 }];
    expect((await order(lines, "post", 90_000)).body.error).toBe("delivery_fee_changed");
    expect((await order(lines, "tipax", 0)).body.error).toBe("delivery_fee_changed"); // tipax is not eligible
    expect((await order(lines, "post", 0)).status).toBe(201);
    expect((await order(lines, "tipax", 120_000)).status).toBe(201);
  });

  it("malformed fees are rejected by validation: fractions, negatives, huge numbers, text, null, missing", async () => {
    const p = await S.product({ name: "اثر", fulfillment: "stocked", inventory: 5 });
    const lines = [{ slug: p.slug, quantity: 1 }];
    for (const fee of [0.5, -1, 10 ** 16, 1e21, "0", null, undefined, [0], { a: 1 }]) {
      const r = await order(lines, "post", fee);
      expect(r.status, JSON.stringify(fee)).toBe(422);
    }
    expect(await testDb.db.order.count()).toBe(0);
  });

  it("the browser cannot send totals, prices, fees or a free-shipping flag of its own", async () => {
    const p = await S.product({ name: "اثر", fulfillment: "stocked", inventory: 5, priceToman: 1_000_000 });
    const lines = [{ slug: p.slug, quantity: 1 }];
    for (const extra of [{ totalToman: 1 }, { subtotalToman: 1 }, { shippingFeeToman: 0 }, { freeShipping: true }, { delivery: { feeToman: 0 } }, { thresholdToman: 1 }]) {
      expect((await order(lines, "post", 90_000, SHIPPING, extra)).status, JSON.stringify(extra)).toBe(422);
    }
    expect((await order([{ slug: p.slug, quantity: 1, unitPriceToman: 1 }], "post", 90_000)).status).toBe(422);
    expect((await order([{ slug: p.slug, quantity: 1, priceToman: 1 }], "post", 90_000)).status).toBe(422);
    expect(await testDb.db.order.count()).toBe(0);
  });

  it("quantity and price games change nothing: the threshold is judged on the server's own prices", async () => {
    const p = await S.product({ name: "اثر", fulfillment: "stocked", inventory: 20, priceToman: 1_000_000 });
    // 2 pieces = 2,000,000 < 3,000,000: not free, whatever the browser believes
    expect((await order([{ slug: p.slug, quantity: 2 }], "post", 0)).body.error).toBe("delivery_fee_changed");
    expect((await order([{ slug: p.slug, quantity: 3 }], "post", 0)).status).toBe(201);
    expect((await order([{ slug: p.slug, quantity: 21 }], "post", 0)).status).toBe(422); // above the per-line limit
    expect((await order([{ slug: p.slug, quantity: 0 }], "post", 90_000)).status).toBe(422);
    expect((await order([{ slug: p.slug, quantity: -3 }], "post", 0)).status).toBe(422);
  });

  it("the same product twice in one cart (to split lines) is refused", async () => {
    const p = await S.product({ name: "اثر", fulfillment: "stocked", inventory: 20, priceToman: 1_700_000 });
    expect((await order([{ slug: p.slug, quantity: 1 }, { slug: p.slug, quantity: 1 }], "post", 0)).status).toBe(422);
  });
});

describe("unavailable delivery methods", () => {
  it("nothing is orderable while all methods are off; a method switched off while the page is open refuses the order and reports the prices", async () => {
    const p = await S.product({ name: "اثر", fulfillment: "stocked", inventory: 5 });
    const lines = [{ slug: p.slug, quantity: 1 }];
    expect((await order(lines, "post", 90_000)).body.error).toBe("delivery_unavailable");
    await put(OFF, [method("post"), method("tipax"), method("pickup")]);
    expect((await order(lines, "post", 90_000)).status).toBe(201);
    await put(OFF, [method("post", { enabled: false }), method("tipax"), method("pickup")]);
    const refused = await order(lines, "post", 90_000);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("delivery_unavailable");
    expect(q({ body: refused.body }, "post")).toMatchObject({ available: false, reason: "disabled" });
    expect(await testDb.db.order.count()).toBe(1);
  });

  it("an address outside a method's area, a cart too heavy for it, and a city the courier does not serve", async () => {
    await put(OFF, [
      method("post"),
      method("tipax", { rates: [rate({ provinces: ["تهران"], maxWeightGrams: 1000, priceToman: 120_000 })] }),
      method("local_courier", { rates: [rate({ provinces: ["تهران"], cities: ["تهران"], priceToman: 60_000 })] }),
      method("pickup"),
    ]);
    const p = await S.product({ name: "سنگین", fulfillment: "stocked", inventory: 9, weightGrams: 2000 });
    const lines = [{ slug: p.slug, quantity: 1 }];
    const heavy = await order(lines, "tipax", 120_000); // 2000 g > 1000 g
    expect(heavy.body.error).toBe("delivery_unavailable");
    const karaj = await order(lines, "local_courier", 60_000, { ...SHIPPING, province: "البرز", city: "کرج" });
    expect(karaj.body.error).toBe("delivery_unavailable");
    const quoted = await quote(lines, { province: "فارس", city: "شیراز" });
    expect(q(quoted, "local_courier")).toMatchObject({ available: false, reason: "not_served" });
    expect(q(quoted, "tipax")).toMatchObject({ available: false, reason: "not_served" });
    expect(await testDb.db.order.count()).toBe(0);
    expect((await testDb.db.product.findUniqueOrThrow({ where: { id: p.id } })).inventory).toBe(9);
  });

  it("an unknown method is a validation error, not a price", async () => {
    const p = await S.product({ name: "اثر" });
    expect((await order([{ slug: p.slug, quantity: 1 }], "drone", 0)).status).toBe(422);
    expect((await order([{ slug: p.slug, quantity: 1 }], "", 0)).status).toBe(422);
  });
});

describe("delivery information is validated before anything is priced or reserved", () => {
  beforeEach(async () => {
    await put(OFF, [method("post"), method("tipax"), method("local_courier"), method("pickup")]);
  });

  const bad: Array<[string, Record<string, unknown>, string]> = [
    ["unknown province", { province: "جایی" }, "shipping.province"],
    ["province in Latin letters", { province: "Tehran" }, "shipping.province"],
    ["postal code too short", { postalCode: "12345" }, "shipping.postalCode"],
    ["postal code with a forbidden first digit", { postalCode: "0000000000" }, "shipping.postalCode"],
    ["postal code with letters", { postalCode: "14598abcde" }, "shipping.postalCode"],
    ["phone that is not a mobile number", { recipientPhone: "02112345678" }, "shipping.recipientPhone"],
    ["phone too short", { recipientPhone: "0912" }, "shipping.recipientPhone"],
    ["one-letter name", { recipientName: "ع" }, "shipping.recipientName"],
    ["street too short", { street: "کوچه" }, "shipping.street"],
    ["empty city", { city: "" }, "shipping.city"],
    ["one-letter city", { city: "ت" }, "shipping.city"],
    ["oversized street", { street: "x".repeat(201) }, "shipping.street"],
    ["unknown address field", { country: "IR" }, "shipping"],
  ];

  it.each(["post", "tipax", "local_courier"])("%s: every invalid field is refused with its path, and nothing is stored or reserved", async (deliveryMethod) => {
    const p = await S.product({ name: "اثر", fulfillment: "stocked", inventory: 5 });
    for (const [label, patch, path] of bad) {
      const r = await order([{ slug: p.slug, quantity: 1 }], deliveryMethod, 90_000, { ...SHIPPING, ...patch });
      expect(r.status, label).toBe(422);
      expect(r.body.issues.map((i: any) => i.path), label).toContain(path);
      expect(JSON.stringify(r.body), label).not.toContain("1459813176"); // no value is echoed back
    }
    for (const missing of ["recipientName", "recipientPhone", "province", "city", "street", "postalCode"]) {
      const { [missing]: _removed, ...rest } = SHIPPING as Record<string, string>;
      void _removed;
      expect((await order([{ slug: p.slug, quantity: 1 }], deliveryMethod, 90_000, rest)).status, `missing ${missing}`).toBe(422);
    }
    expect((await order([{ slug: p.slug, quantity: 1 }], deliveryMethod, 90_000, PICKUP)).status).toBe(422); // name and phone alone are not an address
    expect(await testDb.db.order.count()).toBe(0);
    expect((await testDb.db.product.findUniqueOrThrow({ where: { id: p.id } })).inventory).toBe(5);
  });

  it("Persian digits and a valid address are accepted and stored normalised", async () => {
    const p = await S.product({ name: "اثر", fulfillment: "stocked", inventory: 5 });
    const r = await order([{ slug: p.slug, quantity: 1 }], "post", 90_000, { ...SHIPPING, recipientPhone: "۰۹۱۲۱۲۳۴۵۶۷", postalCode: "۱۴۵۹۸۱۳۱۷۶" });
    expect(r.status).toBe(201);
    expect(r.body.order.shipping).toMatchObject({ recipientPhone: "+989121234567", postalCode: "1459813176", province: "تهران" });
  });

  it("pickup refuses address fields and bad contact details", async () => {
    const p = await S.product({ name: "اثر", fulfillment: "stocked", inventory: 5 });
    const lines = [{ slug: p.slug, quantity: 1 }];
    expect((await order(lines, "pickup", 0, { ...PICKUP, street: "خیابان ولیعصر" })).status).toBe(422);
    expect((await order(lines, "pickup", 0, { ...PICKUP, recipientPhone: "12" })).status).toBe(422);
    expect((await order(lines, "pickup", 0, { recipientName: "علی رضایی" })).status).toBe(422);
    expect((await order(lines, "pickup", 0, PICKUP)).status).toBe(201);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted field by field */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { buildTestApp, call as adminCall, type Session, type TestApp } from "../testing/app";
import { shop, type Customer } from "../testing/shop";

let testDb: TestDatabase;
let app: TestApp;
let categoryId: string;
let owner: Session;
let S: ReturnType<typeof shop>;

beforeAll(async () => void (testDb = await createTestDatabase()), 60_000);
afterAll(async () => testDb.close());
beforeEach(async () => {
  app = await buildTestApp(testDb);
  categoryId = (await app.repo.createCategory({ slug: "wall", name: "دیوارکوب" })).id;
  owner = await app.session("owner");
  S = shop(() => app, () => testDb, () => categoryId);
});

const stock = async (id: string) => (await testDb.db.product.findUniqueOrThrow({ where: { id } })).inventory;
const variantStock = async (sku: string) => (await testDb.db.productVariant.findFirstOrThrow({ where: { sku } })).inventory;
const act = (number: number, to: string, expectedStatus: string, reason?: string, as: Session | null = owner) =>
  adminCall(app, { method: "POST", path: `/api/v1/orders/${number}/transition`, as, body: { to, expectedStatus, ...(reason ? { reason } : {}) } });
const publicFile = async (slug: string) => {
  await app.settle();
  const text = app.storage.text(`catalog/products/${slug}.json`);
  return text ? JSON.parse(text) : null;
};
const placed = (r: Awaited<ReturnType<typeof S.place>>): number => r.body.order.number;

describe("reservations at checkout", () => {
  it("takes stock out of the product (or the chosen variant) with the order, none for made-to-order", async () => {
    const stocked = await S.product({ name: "کوسن", fulfillment: "stocked", variants: [{ sku: "CU-S", options: { size: "S" }, inventory: 5, priceToman: 500_000 }, { sku: "CU-L", options: { size: "L" }, inventory: 2, priceToman: 800_000 }] });
    const plain = await S.product({ name: "ساده", fulfillment: "stocked", inventory: 7 });
    const made = await S.product({ name: "سفارشی", fulfillment: "made_to_order", leadTimeDays: 9, inventory: null });
    const me = await S.signIn();
    const r = await S.place(me, [{ slug: stocked.slug, sku: "CU-S", quantity: 3 }, { slug: plain.slug, quantity: 2 }, { slug: made.slug, quantity: 4 }]);
    expect(r.status).toBe(201);
    expect(await variantStock("CU-S")).toBe(2);
    expect(await variantStock("CU-L")).toBe(2); // another variant is untouched
    expect(await stock(plain.id)).toBe(5);
    expect(await stock(made.id)).toBeNull();
  });

  it("a unique piece is sold to exactly ONE of many simultaneous shoppers", async () => {
    const piece = await S.product({ name: "اثر یگانه", inventory: 1 });
    const shoppers: Customer[] = [];
    for (let i = 0; i < 8; i++) shoppers.push(await S.signIn());
    const results = await Promise.all(shoppers.map((c) => S.place(c, [{ slug: piece.slug, quantity: 1 }])));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const losers = results.filter((r) => r.status !== 201);
    expect(losers).toHaveLength(7);
    for (const r of losers) {
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("items_unavailable");
      expect(r.body.items[0]).toMatchObject({ slug: piece.slug, reason: "sold_out" });
    }
    expect(await stock(piece.id)).toBe(0);
    expect(await testDb.db.order.count()).toBe(1);
    expect(await testDb.db.orderItem.aggregate({ _sum: { reservedQuantity: true } })).toMatchObject({ _sum: { reservedQuantity: 1 } });
  });

  it("never oversells stocked goods: 12 simultaneous orders for 5 units get exactly 5", async () => {
    const p = await S.product({ name: "کالا", fulfillment: "stocked", inventory: 5 });
    const shoppers: Customer[] = [];
    for (let i = 0; i < 12; i++) shoppers.push(await S.signIn());
    const results = await Promise.all(shoppers.map((c) => S.place(c, [{ slug: p.slug, quantity: 1 }])));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await stock(p.id)).toBe(0);
    expect((await testDb.db.orderItem.aggregate({ _sum: { reservedQuantity: true } }))._sum.reservedQuantity).toBe(5);
  });

  it("mixed quantities: stock 5, three orders of 2 → two succeed, the third is told only 1 is left", async () => {
    const p = await S.product({ name: "کالا", fulfillment: "stocked", inventory: 5 });
    const shoppers: Customer[] = [];
    for (let i = 0; i < 3; i++) shoppers.push(await S.signIn());
    const results = await Promise.all(shoppers.map((c) => S.place(c, [{ slug: p.slug, quantity: 2 }])));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    const lost = results.find((r) => r.status === 409)!;
    expect(lost.body.items[0]).toMatchObject({ reason: "insufficient_stock", available: 1 });
    expect(await stock(p.id)).toBe(1);
  });

  it("a multi-item order is all-or-nothing: if one line loses the race nothing is reserved for the others", async () => {
    const a = await S.product({ name: "الفبا", fulfillment: "stocked", inventory: 5 });
    const b = await S.product({ name: "برگ", inventory: 1 });
    const first = await S.signIn();
    const second = await S.signIn();
    expect((await S.place(first, [{ slug: b.slug, quantity: 1 }])).status).toBe(201); // takes the only "ب"
    const r = await S.place(second, [{ slug: a.slug, quantity: 2 }, { slug: b.slug, quantity: 1 }]);
    expect(r.status).toBe(409);
    expect(await stock(a.id)).toBe(5); // "الف" was not held back for the failed order
    expect(await testDb.db.order.count()).toBe(1);
  });

  it("orders that list the same products in opposite orders never deadlock or error", async () => {
    const a = await S.product({ name: "الفبا", fulfillment: "stocked", inventory: 40 });
    const b = await S.product({ name: "برگ", fulfillment: "stocked", inventory: 40 });
    const shoppers: Customer[] = [];
    for (let i = 0; i < 12; i++) shoppers.push(await S.signIn());
    const results = await Promise.all(shoppers.map((c, i) => S.place(c, i % 2 === 0 ? [{ slug: a.slug, quantity: 1 }, { slug: b.slug, quantity: 1 }] : [{ slug: b.slug, quantity: 1 }, { slug: a.slug, quantity: 1 }])));
    expect(results.map((r) => r.status)).toEqual(Array(12).fill(201));
    expect(await stock(a.id)).toBe(28);
    expect(await stock(b.id)).toBe(28);
  });

  it("a retried or concurrent checkout of the SAME attempt reserves once", async () => {
    const p = await S.product({ name: "کالا", fulfillment: "stocked", inventory: 10 });
    const me = await S.signIn();
    const id = "00000000-0000-4000-9000-0000000000aa";
    const results = await Promise.all(Array.from({ length: 6 }, () => S.place(me, [{ slug: p.slug, quantity: 2 }], { requestId: id })));
    expect(new Set(results.map((r) => r.body.order.number)).size).toBe(1);
    expect(await stock(p.id)).toBe(8); // 10 − 2, once
    expect(await testDb.db.order.count()).toBe(1);
  });

  it("refreshes what the storefront sees: a piece that was just sold reads as sold out, and comes back on cancel", async () => {
    const piece = await S.product({ name: "اثر", inventory: 1 });
    await app.deps.publisher.sync([{ id: piece.id }]); // as the admin API does when a product is published
    expect((await publicFile(piece.slug)).availability).toBe("in_stock");
    const me = await S.signIn();
    const n = placed(await S.place(me, [{ slug: piece.slug, quantity: 1 }]));
    expect((await publicFile(piece.slug)).availability).toBe("sold_out");
    expect((await act(n, "cancelled", "pending", "پشیمان شدم")).status).toBe(200);
    expect((await publicFile(piece.slug)).availability).toBe("in_stock");
  });

  it("bumps the product's version, so an admin editing a stale copy gets a conflict instead of overwriting the reserved stock", async () => {
    const p = await S.product({ name: "کالا", fulfillment: "stocked", inventory: 5 });
    const stale = (await adminCall(app, { path: `/api/v1/products/${p.id}`, as: owner })).body.product;
    const me = await S.signIn();
    expect((await S.place(me, [{ slug: p.slug, quantity: 3 }])).status).toBe(201);
    const body = { slug: stale.slug, name: stale.name, description: stale.description, categoryId: stale.categoryId, status: stale.status, fulfillment: stale.fulfillment, priceToman: stale.priceToman, inventory: stale.inventory, leadTimeDays: null, images: stale.images.map((i: any) => ({ key: i.key, alt: i.alt })), variants: [] };
    const edit = await adminCall(app, { method: "PUT", path: `/api/v1/products/${p.id}`, as: owner, body: { expectedVersion: stale.version, product: body } });
    expect(edit.status).toBe(409);
    expect(edit.body.error).toBe("version_conflict");
    expect(await stock(p.id)).toBe(2);
  });
});

describe("rejecting and cancelling give stock back, exactly once", () => {
  it("staff reject a pending order: stock returns, the reason is shown to the customer, history and audit are written", async () => {
    const p = await S.product({ name: "کالا", fulfillment: "stocked", inventory: 4 });
    const me = await S.signIn();
    const n = placed(await S.place(me, [{ slug: p.slug, quantity: 3 }]));
    expect(await stock(p.id)).toBe(1);
    const r = await act(n, "rejected", "pending", "موجودی واقعی کمتر بود");
    expect(r.status).toBe(200);
    expect(r.body.order.status).toBe("rejected");
    expect(await stock(p.id)).toBe(4);
    expect((await testDb.db.orderItem.findFirstOrThrow()).reservedQuantity).toBe(0);

    // the customer's own history shows the new status, when and why (never which staff member)
    const mine = (await S.call(`/api/v1/customer/orders/${n}`, { as: me })).body.order;
    expect(mine.status).toBe("rejected");
    expect(mine.history.map((h: any) => [h.status, h.by, h.reason])).toEqual([["pending", "customer", null], ["rejected", "staff", "موجودی واقعی کمتر بود"]]);
    expect(JSON.stringify(mine)).not.toContain("owner@example.test");
    expect((await S.call("/api/v1/customer/orders", { as: me })).body.items[0].status).toBe("rejected");

    // staff see who did it
    const staff = (await adminCall(app, { path: `/api/v1/orders/${n}`, as: owner })).body.order;
    expect(staff.history.map((h: any) => [h.from, h.to, h.actor, h.actorLabel])).toEqual([[null, "pending", "customer", null], ["pending", "rejected", "staff", "owner@example.test"]]);
    expect(staff.items[0].reservedQuantity).toBe(0);

    const audit = await testDb.db.auditLog.findMany({ where: { entity: "order" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "order.rejected", actorEmail: "owner@example.test" });
    expect(audit[0]?.detail).toMatchObject({ number: n, from: "pending", to: "rejected", released: 3 });
    expect(JSON.stringify(audit)).not.toContain("+98912"); // no phone numbers in the audit log
  });

  it("a customer may cancel their own PENDING order (stock returns); not someone else's, not once confirmed", async () => {
    const p = await S.product({ name: "کالا", fulfillment: "stocked", inventory: 4 });
    const me = await S.signIn();
    const other = await S.signIn();
    const n = placed(await S.place(me, [{ slug: p.slug, quantity: 2 }]));
    expect((await S.call(`/api/v1/customer/orders/${n}/cancel`, { method: "POST", as: other, body: {} })).status).toBe(404); // not theirs
    expect(await stock(p.id)).toBe(2);
    const done = await S.call(`/api/v1/customer/orders/${n}/cancel`, { method: "POST", as: me, body: { reason: "اشتباه" } });
    expect(done.status).toBe(200);
    expect(done.body.order.status).toBe("cancelled");
    expect(await stock(p.id)).toBe(4);
    expect((await S.call(`/api/v1/customer/orders/${n}/cancel`, { method: "POST", as: me, body: {} })).status).toBe(409); // already final

    const n2 = placed(await S.place(me, [{ slug: p.slug, quantity: 1 }]));
    expect((await act(n2, "confirmed", "pending")).status).toBe(200);
    const late = await S.call(`/api/v1/customer/orders/${n2}/cancel`, { method: "POST", as: me, body: {} });
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ error: "invalid_transition", currentStatus: "confirmed" });
    expect(await stock(p.id)).toBe(3);
    expect((await S.call(`/api/v1/customer/orders/${n2}/cancel`, { method: "POST", as: me, body: {}, csrf: "wrong" })).status).toBe(403);
  });

  it("staff cancel an order at any stage before it ships; after shipping they cannot", async () => {
    const p = await S.product({ name: "کالا", fulfillment: "stocked", inventory: 9 });
    const me = await S.signIn();
    for (const upTo of ["confirmed", "preparing"] as const) {
      const n = placed(await S.place(me, [{ slug: p.slug, quantity: 1 }]));
      await act(n, "confirmed", "pending");
      if (upTo === "preparing") await act(n, "preparing", "confirmed");
      expect((await act(n, "cancelled", upTo)).status).toBe(200);
    }
    expect(await stock(p.id)).toBe(9);
    const n = placed(await S.place(me, [{ slug: p.slug, quantity: 1 }]));
    for (const [to, from] of [["confirmed", "pending"], ["preparing", "confirmed"], ["shipped", "preparing"]] as const) expect((await act(n, to, from)).status).toBe(200);
    const late = await act(n, "cancelled", "shipped");
    expect(late.status).toBe(409);
    expect(late.body.error).toBe("invalid_transition");
    expect(await stock(p.id)).toBe(8); // shipped: stock stays consumed
    expect((await act(n, "delivered", "shipped")).body.order.status).toBe("delivered");
    expect((await act(n, "cancelled", "delivered")).status).toBe(409);
  });

  it("two simultaneous cancels (customer + staff + staff again) give the stock back ONCE", async () => {
    const p = await S.product({ name: "کالا", fulfillment: "stocked", inventory: 5 });
    const me = await S.signIn();
    const n = placed(await S.place(me, [{ slug: p.slug, quantity: 4 }]));
    expect(await stock(p.id)).toBe(1);
    const results = await Promise.all([
      act(n, "cancelled", "pending", "الف"),
      act(n, "cancelled", "pending", "ب"),
      act(n, "rejected", "pending", "ج"),
      S.call(`/api/v1/customer/orders/${n}/cancel`, { method: "POST", as: me, body: {} }),
      act(n, "cancelled", "pending", "د"),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await stock(p.id)).toBe(5); // 1 + 4, not 1 + 4×N
    expect((await testDb.db.orderStatusEvent.findMany({ where: { toStatus: { in: ["cancelled", "rejected"] } } }))).toHaveLength(1);
    expect(await testDb.db.auditLog.count({ where: { entity: "order" } })).toBe(1);
  });

  it("confirm racing with cancel: exactly one wins and the stock matches the winner", async () => {
    for (let round = 0; round < 6; round++) {
      const p = await S.product({ name: `کالا ${round}`, fulfillment: "stocked", inventory: 3 });
      const me = await S.signIn();
      const n = placed(await S.place(me, [{ slug: p.slug, quantity: 2 }]));
      const [confirm, cancel] = await Promise.all([act(n, "confirmed", "pending"), act(n, "cancelled", "pending")]);
      expect([confirm.status, cancel.status].sort()).toEqual([200, 409]);
      const status = (await testDb.db.order.findUniqueOrThrow({ where: { number: n } })).status;
      expect(status).toBe(confirm.status === 200 ? "confirmed" : "cancelled");
      expect(await stock(p.id)).toBe(status === "cancelled" ? 3 : 1);
    }
  });

  it("variants are given back to the same variant; a re-stocked unique piece never goes above one", async () => {
    const v = await S.product({ name: "کوسن", fulfillment: "stocked", variants: [{ sku: "CU-S", options: { size: "S" }, inventory: 2, priceToman: 1 * 500_000 }, { sku: "CU-L", options: { size: "L" }, inventory: 2, priceToman: 800_000 }] });
    const unique = await S.product({ name: "یگانه", inventory: 1 });
    const me = await S.signIn();
    const n = placed(await S.place(me, [{ slug: v.slug, sku: "CU-L", quantity: 2 }, { slug: unique.slug, quantity: 1 }]));
    expect(await variantStock("CU-L")).toBe(0);
    expect(await stock(unique.id)).toBe(0);
    await testDb.db.product.update({ where: { id: unique.id }, data: { inventory: 1 } }); // staff re-stocked it by hand meanwhile
    expect((await act(n, "cancelled", "pending")).status).toBe(200);
    expect(await variantStock("CU-L")).toBe(2);
    expect(await variantStock("CU-S")).toBe(2);
    expect(await stock(unique.id)).toBe(1); // not 2 (the database allows only 0 or 1)
  });

  it("orders placed before reservations existed (nothing held) give back nothing; made-to-order gives back nothing", async () => {
    const p = await S.product({ name: "کالا", fulfillment: "stocked", inventory: 5 });
    const made = await S.product({ name: "سفارشی", fulfillment: "made_to_order", leadTimeDays: 5, inventory: null });
    const me = await S.signIn();
    const n = placed(await S.place(me, [{ slug: p.slug, quantity: 2 }, { slug: made.slug, quantity: 1 }]));
    await testDb.db.orderItem.updateMany({ data: { reservedQuantity: 0 } }); // as if placed by the previous version
    await testDb.db.product.update({ where: { id: p.id }, data: { inventory: 3 } });
    expect((await act(n, "rejected", "pending")).status).toBe(200);
    expect(await stock(p.id)).toBe(3);
    expect(await stock(made.id)).toBeNull();
  });

  it("a rejected or cancelled order no longer counts as open (the customer can order again)", async () => {
    const p = await S.product({ name: "کالا", fulfillment: "stocked", inventory: 99 });
    const me = await S.signIn();
    const numbers: number[] = [];
    for (let i = 0; i < 10; i++) numbers.push(placed(await S.place(me, [{ slug: p.slug, quantity: 1 }])));
    expect((await S.place(me, [{ slug: p.slug, quantity: 1 }])).body.error).toBe("too_many_open_orders");
    await act(numbers[0]!, "rejected", "pending");
    expect((await S.place(me, [{ slug: p.slug, quantity: 1 }])).status).toBe(201);
  });
});

describe("staff transitions: rules and permissions", () => {
  it("only owner and support may change orders; editor and viewer may not even read them", async () => {
    const p = await S.product({ name: "کالا", fulfillment: "stocked", inventory: 3 });
    const n = placed(await S.place(await S.signIn(), [{ slug: p.slug, quantity: 1 }]));
    for (const role of ["editor", "viewer"] as const) {
      const s = await app.session(role);
      expect((await act(n, "confirmed", "pending", undefined, s)).status, role).toBe(403);
      expect((await adminCall(app, { path: "/api/v1/orders/summary", as: s })).status, role).toBe(403);
    }
    expect((await act(n, "confirmed", "pending", undefined, null)).status).toBe(401);
    const support = await app.session("support");
    expect((await act(n, "confirmed", "pending", undefined, support)).status).toBe(200);
    expect((await testDb.db.orderStatusEvent.findFirstOrThrow({ where: { toStatus: "confirmed" } })).actorLabel).toBe("support@example.test");
  });

  it("refuses illegal moves, stale screens, unknown orders and malformed requests, changing nothing", async () => {
    const p = await S.product({ name: "کالا", fulfillment: "stocked", inventory: 3 });
    const n = placed(await S.place(await S.signIn(), [{ slug: p.slug, quantity: 1 }]));
    const skip = await act(n, "shipped", "pending");
    expect(skip.status).toBe(409);
    expect(skip.body).toMatchObject({ error: "invalid_transition", currentStatus: "pending" });
    const stale = await act(n, "confirmed", "preparing");
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: "order_changed", currentStatus: "pending" });
    expect((await act(99999, "confirmed", "pending")).status).toBe(404);
    for (const body of [{}, { to: "confirmed" }, { to: "bogus", expectedStatus: "pending" }, { to: "confirmed", expectedStatus: "pending", extra: 1 }, { to: "rejected", expectedStatus: "pending", reason: "x".repeat(201) }]) {
      expect((await adminCall(app, { method: "POST", path: `/api/v1/orders/${n}/transition`, as: owner, body })).status).toBe(422);
    }
    expect((await adminCall(app, { method: "POST", path: `/api/v1/orders/${n}/transition`, as: owner, body: { to: "confirmed", expectedStatus: "pending" }, csrf: "wrong" })).status).toBe(403);
    expect((await adminCall(app, { method: "GET", path: `/api/v1/orders/${n}/transition`, as: owner })).status).toBe(405);
    expect((await testDb.db.order.findUniqueOrThrow({ where: { number: n } })).status).toBe("pending");
    expect(await testDb.db.orderStatusEvent.count()).toBe(1); // only the "placed" entry
    expect(await stock(p.id)).toBe(2);
  });

  it("the summary counts pending orders (the 'new orders' indicator)", async () => {
    const p = await S.product({ name: "کالا", fulfillment: "stocked", inventory: 9 });
    expect((await adminCall(app, { path: "/api/v1/orders/summary", as: owner })).body).toEqual({ pending: 0, newestPlacedAt: null });
    const me = await S.signIn();
    const a = placed(await S.place(me, [{ slug: p.slug, quantity: 1 }]));
    placed(await S.place(me, [{ slug: p.slug, quantity: 1 }]));
    const summary = (await adminCall(app, { path: "/api/v1/orders/summary", as: owner })).body;
    expect(summary.pending).toBe(2);
    expect(typeof summary.newestPlacedAt).toBe("string");
    await act(a, "confirmed", "pending");
    expect((await adminCall(app, { path: "/api/v1/orders/summary", as: owner })).body.pending).toBe(1);
  });

  it("history lists every step in order, with staff identity only for staff", async () => {
    const p = await S.product({ name: "کالا", fulfillment: "stocked", inventory: 3 });
    const me = await S.signIn();
    const n = placed(await S.place(me, [{ slug: p.slug, quantity: 1 }]));
    for (const [to, from] of [["confirmed", "pending"], ["preparing", "confirmed"], ["shipped", "preparing"], ["delivered", "shipped"]] as const) {
      app.advance(60_000);
      await act(n, to, from);
    }
    const staff = (await adminCall(app, { path: `/api/v1/orders/${n}`, as: owner })).body.order.history;
    expect(staff.map((h: any) => h.to)).toEqual(["pending", "confirmed", "preparing", "shipped", "delivered"]);
    expect(staff.slice(1).every((h: any) => h.actorLabel === "owner@example.test")).toBe(true);
    const mine = (await S.call(`/api/v1/customer/orders/${n}`, { as: me })).body.order.history;
    expect(mine.map((h: any) => h.status)).toEqual(["pending", "confirmed", "preparing", "shipped", "delivered"]);
    expect(Object.keys(mine[1]).sort()).toEqual(["at", "by", "reason", "status"]);
  });
});

describe("privacy", () => {
  it("anonymising a customer keeps that an order was refused but drops the reason staff wrote; the export includes the history", async () => {
    const p = await S.product({ name: "کالا", fulfillment: "stocked", inventory: 3 });
    const me = await S.signIn();
    const n = placed(await S.place(me, [{ slug: p.slug, quantity: 1 }]));
    await act(n, "rejected", "pending", "با شما تماس گرفتیم، آقای رضایی");
    const exported = (await S.call("/api/v1/customer/account/export", { method: "POST", as: me, body: {} })).body;
    expect(exported.orders[0].history.map((h: any) => h.status)).toEqual(["pending", "rejected"]);
    await testDb.db.customer.update({ where: { id: me.id }, data: { status: "pending_deletion", deletionScheduledAt: new Date(0) } });
    await testDb.db.order.updateMany({ data: { status: "rejected" } });
    expect(await app.platform.accountStore.anonymize(me.id, new Date())).toBe(true);
    const events = await testDb.db.orderStatusEvent.findMany();
    expect(events.map((e) => e.toStatus).sort()).toEqual(["pending", "rejected"]);
    expect(events.every((e) => e.reason === null)).toBe(true);
  });
});

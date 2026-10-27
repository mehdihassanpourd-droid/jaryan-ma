/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted field by field */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newOrderSchema } from "../../src/domain/customer/schema";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { ensureDefaultVendor } from "../db/vendor";
import { buildTestApp, call, type TestApp } from "../testing/app";

let testDb: TestDatabase;
let app: TestApp;
let vendorId: string;
let productId: string;

beforeAll(async () => void (testDb = await createTestDatabase()), 60_000);
afterAll(async () => testDb.close());
beforeEach(async () => {
  app = await buildTestApp(testDb);
  vendorId = await ensureDefaultVendor(testDb.db);
  productId = (await testDb.db.product.create({ data: { vendorId, slug: "p", name: "p", fulfillment: "stocked", inventory: 9, priceToman: 1000n, searchText: "p" } })).id;
});

async function customer(phone: string, names: [string | null, string | null] = ["علی", "رضایی"]) {
  return testDb.db.customer.create({ data: { phone, firstName: names[0], lastName: names[1], termsAcceptedAt: new Date(), termsVersion: "2026-01", phoneVerifiedAt: new Date() } });
}
async function order(customerId: string, over: { qty?: number; unit?: number; status?: "pending" | "delivered" } = {}) {
  const unit = over.unit ?? 1_500_000;
  const qty = over.qty ?? 2;
  const created = await app.platform.accountStore.createOrder(
    newOrderSchema.parse({
      customerId, requestId: null, totalToman: unit * qty, customerNote: "هدیه",
      items: [{ productId, vendorId, titleSnapshot: "کوسن", skuSnapshot: "CU-M", variantSnapshot: { اندازه: "متوسط" }, unitPriceToman: unit, quantity: qty }],
      shipping: { recipientName: "علی رضایی", recipientPhone: "09121234567", province: "تهران", city: "تهران", street: "خیابان ولیعصر ۱۲", postalCode: "1459813176" },
    }),
    new Date(),
  );
  if (over.status && over.status !== "pending") await testDb.db.order.update({ where: { number: created.number }, data: { status: over.status } });
  return created;
}
const as = async (role: "owner" | "editor" | "support" | "viewer") => ({ as: await app.session(role) });

describe("admin orders (read-only, personal data)", () => {
  it("owner and support read orders; editor and viewer (catalogue roles) cannot, and nothing is writable", async () => {
    const c = await customer("+989121234567");
    const o = await order(c.id);
    for (const role of ["owner", "support"] as const) {
      const r = await call(app, { path: "/api/v1/orders", ...(await as(role)) });
      expect(r.status, role).toBe(200);
      expect(r.body.items.map((x: any) => x.number)).toEqual([o.number]);
    }
    for (const role of ["editor", "viewer"] as const) {
      expect((await call(app, { path: "/api/v1/orders", ...(await as(role)) })).status, role).toBe(403);
      expect((await call(app, { path: `/api/v1/orders/${o.number}`, ...(await as(role)) })).status, role).toBe(403);
    }
    expect((await call(app, { path: "/api/v1/orders", as: null })).status).toBe(401);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await call(app, { method, path: `/api/v1/orders/${o.number}`, body: {}, ...(await as("owner")) })).status, method).toBe(405);
    }
    const permissions = (await call(app, { path: "/api/v1/auth/session", ...(await as("support")) })).body.permissions;
    expect(permissions).toContain("order:read");
    expect((await call(app, { path: "/api/v1/auth/session", ...(await as("editor")) })).body.permissions).not.toContain("order:read");
  });

  it("shows who ordered what, the exact total, and the delivery address", async () => {
    const c = await customer("+989121234567");
    const o = await order(c.id, { qty: 3, unit: 999_999_999_999_999 / 3 | 0 });
    const r = await call(app, { path: `/api/v1/orders/${o.number}`, ...(await as("owner")) });
    expect(r.status).toBe(200);
    expect(r.body.order).toMatchObject({
      number: o.number, status: "pending", customer: { phone: "+989121234567", name: "علی رضایی" }, customerNote: "هدیه",
      shipping: { recipientName: "علی رضایی", province: "تهران", postalCode: "1459813176" },
      items: [{ title: "کوسن", sku: "CU-M", variant: { اندازه: "متوسط" }, quantity: 3 }],
    });
    expect(r.body.order.totalToman).toBe(3 * (999_999_999_999_999 / 3 | 0));
    expect((await call(app, { path: "/api/v1/orders/999999", ...(await as("owner")) })).status).toBe(404);
    expect((await call(app, { path: "/api/v1/orders/abc", ...(await as("owner")) })).status).toBe(404);
  });

  it("lists newest first with paging and a status filter; rejects a bad filter", async () => {
    const c = await customer("+989121234567");
    const numbers: number[] = [];
    for (let i = 0; i < 5; i++) {
      const o = await order(c.id, { status: i === 1 ? "delivered" : "pending" });
      await testDb.db.order.update({ where: { number: o.number }, data: { placedAt: new Date(Date.UTC(2026, 0, 1 + i)) } }); // distinct, known times
      numbers.push(o.number);
    }
    const page1 = await call(app, { path: "/api/v1/orders?pageSize=2", ...(await as("owner")) });
    expect(page1.body.total).toBe(5);
    expect(page1.body.items.map((x: any) => x.number)).toEqual([numbers[4], numbers[3]]);
    expect((await call(app, { path: "/api/v1/orders?pageSize=2&page=3", ...(await as("owner")) })).body.items.map((x: any) => x.number)).toEqual([numbers[1]]);
    const all = (await call(app, { path: "/api/v1/orders?pageSize=50", ...(await as("owner")) })).body.items.map((x: any) => x.number);
    // open orders first (pending on top), then finished ones; newest first within a status
    expect(all).toEqual([numbers[4], numbers[3], numbers[2], numbers[0], numbers[1]]);
    const delivered = await call(app, { path: "/api/v1/orders?status=delivered", ...(await as("owner")) });
    expect(delivered.body.items.map((x: any) => x.number)).toEqual([numbers[1]]);
    expect((await call(app, { path: "/api/v1/orders?status=bogus", ...(await as("owner")) })).status).toBe(400);
  });

  it("an anonymised customer's identity is gone from the order view (the account was deleted)", async () => {
    const c = await customer("+989121234567");
    const o = await order(c.id);
    await testDb.db.customer.update({ where: { id: c.id }, data: { status: "anonymized", phone: `deleted:${c.id}`, firstName: null, lastName: null } });
    const r = await call(app, { path: `/api/v1/orders/${o.number}`, ...(await as("owner")) });
    expect(r.body.order.customer).toEqual({ phone: null, name: null });
  });
});

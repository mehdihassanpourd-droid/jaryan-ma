import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addressInputSchema, newOrderSchema, MAX_ADDRESSES_PER_CUSTOMER, type AddressInput } from "../../src/domain/customer/schema";
import { MAX_TOMAN } from "../../src/domain/money";
import { ensureDefaultVendor } from "../db/vendor";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { AccountError, AccountService } from "./account-service";
import { PrismaAccountStore } from "./prisma-account-store";
import { PrismaCustomerStore } from "./prisma-store";

let testDb: TestDatabase;
let customers: PrismaCustomerStore;
let accounts: PrismaAccountStore;
let svc: AccountService;
let now: Date;
let vendorId: string;
let alice: string;
let bob: string;

const day = 24 * 3600_000;
const addr = (over: Record<string, unknown> = {}): AddressInput =>
  addressInputSchema.parse({ recipientName: "علی رضایی", recipientPhone: "09121234567", province: "تهران", city: "تهران", street: "خیابان ولیعصر، کوچه گل", postalCode: "1459813176", ...over });
const fail = async <T>(p: Promise<T>) => (await p.then(() => null, (e: unknown) => e)) as AccountError | null;

async function product(slug: string, status: "published" | "draft" = "published") {
  return testDb.db.product.create({ data: { vendorId, slug, name: `محصول ${slug}`, fulfillment: "unique", inventory: 1, status, searchText: slug } });
}

async function order(customerId: string, priceToman: number, status: "pending" | "delivered" = "delivered", quantity = 1) {
  const p = await product(`p-${Math.random().toString(36).slice(2, 8)}`);
  const input = newOrderSchema.parse({
    customerId,
    items: [{ productId: p.id, vendorId, titleSnapshot: "سبد", unitPriceToman: priceToman, quantity }],
    shipping: { recipientName: "علی رضایی", recipientPhone: "09121234567", province: "تهران", city: "تهران", street: "خیابان ولیعصر ۱۲", postalCode: "1459813176" },
    customerNote: "زنگ نزنید",
    totalToman: priceToman * quantity,
  });
  const created = await accounts.createOrder(input, now);
  if (status !== "pending") await testDb.db.order.update({ where: { number: created.number }, data: { status } });
  return created;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  customers = new PrismaCustomerStore(testDb.db);
  accounts = new PrismaAccountStore(testDb.db);
}, 60_000);
afterAll(async () => testDb.close());

beforeEach(async () => {
  await testDb.reset();
  now = new Date("2026-03-01T12:00:00.000Z");
  vendorId = await ensureDefaultVendor(testDb.db);
  alice = (await customers.createCustomer({ phone: "+989121234567", termsVersion: "2026-01", now })).id;
  bob = (await customers.createCustomer({ phone: "+989351234567", termsVersion: "2026-01", now })).id;
  svc = new AccountService(accounts, customers, undefined, () => now);
});

describe("addresses", () => {
  it("makes the first address the default and keeps exactly one default", async () => {
    const a = await svc.createAddress(alice, addr());
    const b = await svc.createAddress(alice, addr({ city: "کرج" }));
    expect([a.isDefault, b.isDefault]).toEqual([true, false]);
    const c = await svc.createAddress(alice, addr({ city: "شیراز", province: "فارس", isDefault: true }));
    const list = await svc.listAddresses(alice);
    expect(list.filter((x) => x.isDefault).map((x) => x.id)).toEqual([c.id]);
    await svc.setDefaultAddress(alice, b.id);
    expect((await svc.listAddresses(alice)).filter((x) => x.isDefault).map((x) => x.id)).toEqual([b.id]);
  });

  it("promotes another address when the default is deleted", async () => {
    const a = await svc.createAddress(alice, addr());
    const b = await svc.createAddress(alice, addr({ city: "کرج" }));
    await svc.deleteAddress(alice, a.id);
    expect((await svc.listAddresses(alice)).map((x) => [x.id, x.isDefault])).toEqual([[b.id, true]]);
  });

  it("never lets one customer read or change another's addresses", async () => {
    const a = await svc.createAddress(alice, addr());
    expect(await fail(svc.updateAddress(bob, a.id, addr()))).toMatchObject({ code: "not_found" });
    expect(await fail(svc.deleteAddress(bob, a.id))).toMatchObject({ code: "not_found" });
    expect(await fail(svc.setDefaultAddress(bob, a.id))).toMatchObject({ code: "not_found" });
    expect(await svc.listAddresses(bob)).toEqual([]);
    expect(await svc.listAddresses(alice)).toHaveLength(1);
  });

  it("enforces the per-customer limit", async () => {
    for (let i = 0; i < MAX_ADDRESSES_PER_CUSTOMER; i++) await svc.createAddress(alice, addr());
    expect(await fail(svc.createAddress(alice, addr()))).toMatchObject({ code: "limit_reached" });
  });

  it("stays consistent under concurrent default changes (single default invariant)", async () => {
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push((await svc.createAddress(alice, addr())).id);
    await Promise.all(ids.map((id) => svc.setDefaultAddress(alice, id)));
    await Promise.all(Array.from({ length: 4 }, () => svc.createAddress(alice, addr({ isDefault: true }))));
    const list = await svc.listAddresses(alice);
    expect(list.filter((x) => x.isDefault)).toHaveLength(1);
  });

  it("the database itself refuses two defaults", async () => {
    await svc.createAddress(alice, addr());
    await expect(testDb.db.address.create({ data: { customerId: alice, ...addr(), isDefault: true } })).rejects.toThrow();
  });
});

describe("favourites", () => {
  it("adds, de-duplicates and removes; only published products qualify", async () => {
    await product("a");
    await product("hidden", "draft");
    expect(await svc.addFavorite(alice, "a")).toBe("added");
    expect(await svc.addFavorite(alice, "a")).toBe("exists");
    expect(await fail(svc.addFavorite(alice, "hidden"))).toMatchObject({ code: "not_found" });
    expect(await fail(svc.addFavorite(alice, "nope"))).toMatchObject({ code: "not_found" });
    expect((await svc.listFavorites(alice, 1, 20)).items.map((p) => p.slug)).toEqual(["a"]);
    expect((await svc.listFavorites(bob, 1, 20)).total).toBe(0);
    await svc.removeFavorite(alice, "a");
    await svc.removeFavorite(alice, "a");
    expect((await svc.listFavorites(alice, 1, 20)).total).toBe(0);
  });

  it("hides favourites whose product was unpublished afterwards, but keeps the link", async () => {
    const p = await product("a");
    await svc.addFavorite(alice, "a");
    await testDb.db.product.update({ where: { id: p.id }, data: { status: "archived" } });
    expect((await svc.listFavorites(alice, 1, 20)).items).toEqual([]);
    expect(await accounts.countFavorites(alice)).toBe(1);
  });
});

describe("orders", () => {
  it("lists only the customer's own orders and returns exact large totals", async () => {
    const big = 4_000_000_000_000; // 4 trillion Toman: far above the old 2 billion limit
    const o = await order(alice, big, "delivered", 3);
    await order(bob, 1000);
    const mine = await svc.listOrders(alice, 1, 10);
    expect(mine.total).toBe(1);
    expect(mine.items[0]).toMatchObject({ number: o.number, totalToman: 12_000_000_000_000 });
    expect(mine.items[0]?.items[0]?.unitPriceToman).toBe(big);
    expect(JSON.parse(JSON.stringify(mine)).items[0].totalToman).toBe(12_000_000_000_000);
    expect(await fail(svc.getOrder(bob, o.number))).toMatchObject({ code: "not_found" });
    expect((await svc.getOrder(alice, o.number)).customerNote).toBe("زنگ نزنید");
  });

  it("rejects a tampered total and totals above the supported maximum", async () => {
    const p = await product("x");
    const base = { customerId: alice, shipping: { recipientName: "علی", recipientPhone: "09121234567", province: "تهران", city: "تهران", street: "خیابان ولیعصر", postalCode: "1459813176" } };
    const line = (unit: number, quantity = 1) => ({ productId: p.id, vendorId, titleSnapshot: "x", unitPriceToman: unit, quantity });
    expect(newOrderSchema.safeParse({ ...base, items: [line(1000, 2)], totalToman: 1000 }).success).toBe(false);
    expect(newOrderSchema.safeParse({ ...base, items: [line(MAX_TOMAN, 2)], totalToman: MAX_TOMAN }).success).toBe(false);
    expect(newOrderSchema.safeParse({ ...base, items: [line(MAX_TOMAN)], totalToman: MAX_TOMAN }).success).toBe(true);
  });
});

describe("data export", () => {
  it("contains the customer's own data and nothing internal, and is rate limited", async () => {
    await svc.updateProfile(alice, { firstName: "علی", email: "ali@example.com" });
    await svc.createAddress(alice, addr());
    await product("a");
    await svc.addFavorite(alice, "a");
    await order(alice, 5000);
    await testDb.db.customerOtp.create({ data: { phone: "+989121234567", codeHash: "h".repeat(64), expiresAt: now } });

    const data = await svc.exportData(alice);
    expect(data).toMatchObject({ formatVersion: 1, profile: { phone: "+989121234567", firstName: "علی", email: "ali@example.com" } });
    expect(data.addresses).toHaveLength(1);
    expect(data.favorites.map((f) => f.slug)).toEqual(["a"]);
    expect(data.orders).toHaveLength(1);
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/tokenHash|csrfToken|codeHash|passwordHash/);
    expect(json).not.toContain("+989351234567");

    expect(await fail(svc.exportData(alice))).toMatchObject({ code: "rate_limited", retryAfterSeconds: 3600 });
    now = new Date(now.getTime() + 3600_000);
    await expect(svc.exportData(alice)).resolves.toBeTruthy();
    expect(await testDb.db.customerDataRequest.count({ where: { customerId: alice, type: "export", status: "completed" } })).toBe(2);
  });

  it("includes the support history provided by the support exporter", async () => {
    const withSupport = new AccountService(accounts, customers, undefined, () => now, async (id) => [{ for: id }]);
    expect((await withSupport.exportData(alice)).support).toEqual([{ for: alice }]);
  });
});

describe("account deletion", () => {
  it("starts a grace period, signs out other sessions, and can be cancelled", async () => {
    const keep = await customers.createSession({ customerId: alice, tokenHash: "a".repeat(64), csrfToken: "c", createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + day), ip: null, userAgent: null });
    await customers.createSession({ customerId: alice, tokenHash: "b".repeat(64), csrfToken: "c", createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + day), ip: null, userAgent: null });
    const { scheduledAt } = await svc.requestDeletion(alice, keep.id);
    expect(scheduledAt.getTime() - now.getTime()).toBe(14 * day);
    expect(await testDb.db.customerSession.findMany({ where: { customerId: alice } })).toMatchObject([{ id: keep.id }]);
    expect(await customers.findById(alice)).toMatchObject({ status: "pending_deletion" });
    expect(await svc.requestDeletion(alice)).toEqual({ scheduledAt }); // idempotent
    await svc.cancelDeletion(alice);
    expect(await customers.findById(alice)).toMatchObject({ status: "active", deletionScheduledAt: null });
    expect(await fail(svc.cancelDeletion(alice))).toMatchObject({ code: "not_pending_deletion" });
  });

  it("is refused while an order is still open", async () => {
    await order(alice, 1000, "pending");
    expect(await fail(svc.requestDeletion(alice))).toMatchObject({ code: "open_orders" });
  });

  it("does nothing before the grace period ends, then erases personal data but keeps order totals", async () => {
    await svc.updateProfile(alice, { firstName: "علی", lastName: "رضایی", email: "ali@example.com", marketingOptIn: true });
    await svc.createAddress(alice, addr());
    await product("a");
    await svc.addFavorite(alice, "a");
    const o = await order(alice, 7_000_000_000_000);
    const ticket = await testDb.db.supportTicket.create({
      data: { customerId: alice, subject: "سلام کد ملی من ...", duplicateKey: "k", messages: { create: { author: "customer", body: "آدرس من فلان جاست" } } },
    });
    const admin = await testDb.db.adminUser.create({ data: { email: "s@example.com", passwordHash: "x", role: "support" } });
    await testDb.db.supportNote.create({ data: { ticketId: ticket.id, adminId: admin.id, body: "مشتری ناراضی" } });
    await customers.createSession({ customerId: alice, tokenHash: "a".repeat(64), csrfToken: "c", createdAt: now, lastSeenAt: now, expiresAt: new Date(now.getTime() + day), ip: null, userAgent: null });

    await svc.requestDeletion(alice);
    expect(await svc.runDeletions()).toBe(0);
    now = new Date(now.getTime() + 14 * day + 1);
    expect(await svc.runDeletions()).toBe(1);
    expect(await svc.runDeletions()).toBe(0); // idempotent

    const c = await testDb.db.customer.findUniqueOrThrow({ where: { id: alice } });
    expect(c).toMatchObject({ status: "anonymized", phone: `deleted:${alice}`, firstName: null, lastName: null, email: null, marketingOptIn: false });
    expect(c.anonymizedAt).not.toBeNull();
    expect(await testDb.db.address.count({ where: { customerId: alice } })).toBe(0);
    expect(await testDb.db.favorite.count({ where: { customerId: alice } })).toBe(0);
    expect(await testDb.db.customerSession.count({ where: { customerId: alice } })).toBe(0);

    const kept = await testDb.db.order.findUniqueOrThrow({ where: { number: o.number } });
    expect(kept.totalToman).toBe(7_000_000_000_000n);
    expect(kept.customerNote).toBeNull();
    expect(JSON.stringify(kept.shipping)).not.toMatch(/رضایی|ولیعصر|1459813176|0912|\+9891/);
    expect(kept.shipping).toMatchObject({ province: "تهران", city: "تهران" });

    const t = await testDb.db.supportTicket.findUniqueOrThrow({ where: { id: ticket.id }, include: { messages: true, notes: true } });
    expect(t.subject).not.toContain("کد ملی");
    expect(t.messages[0]?.body).not.toContain("آدرس");
    expect(t.notes[0]?.body).not.toContain("ناراضی");
    expect(await testDb.db.auditLog.findFirst({ where: { action: "customer.anonymized", entityId: alice } })).not.toBeNull();
    expect(JSON.stringify(await testDb.db.auditLog.findMany())).not.toContain("0912");
  });

  it("frees the phone number for a new registration", async () => {
    await svc.requestDeletion(alice);
    now = new Date(now.getTime() + 15 * day);
    await svc.runDeletions();
    const again = await customers.createCustomer({ phone: "+989121234567", termsVersion: "2026-01", now });
    expect(again.id).not.toBe(alice);
    expect(await svc.listAddresses(again.id)).toEqual([]);
  });
});

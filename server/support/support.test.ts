import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { faqItemSchema, ticketCreateSchema, ticketListQuerySchema, ticketUpdateSchema } from "../../src/domain/support/schema";
import { RateLimiter } from "../auth/rate-limit";
import type { AuditEntry } from "../auth/ports";
import { PrismaAccountStore } from "../customers/prisma-account-store";
import { AccountService } from "../customers/account-service";
import { PrismaCustomerStore } from "../customers/prisma-store";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { ensureDefaultVendor } from "../db/vendor";
import { DEFAULT_FAQ } from "./default-faq";
import { PrismaSupportStore } from "./prisma-store";
import { SupportError, SupportService, type StaffActor } from "./service";

let testDb: TestDatabase;
let store: PrismaSupportStore;
let svc: SupportService;
let now: Date;
let alice: { id: string };
let bob: { id: string };
let agent: StaffActor;
let editor: StaffActor;
let viewer: StaffActor;
let owner: StaffActor;
const audits: AuditEntry[] = [];

const hour = 3600_000;
const create = (over: Record<string, unknown> = {}) =>
  ticketCreateSchema.parse({ subject: "سفارش نرسیده", body: "سفارش من هنوز به دستم نرسیده است لطفا بررسی کنید", category: "order", ...over });
const fail = async <T>(p: Promise<T>) => (await p.then(() => null, (e: unknown) => e)) as SupportError | null;
const list = (over: Record<string, unknown> = {}) => ticketListQuerySchema.parse(over);

async function actor(email: string, role: StaffActor["role"]): Promise<StaffActor> {
  const row = await testDb.db.adminUser.create({ data: { email, passwordHash: "x", role } });
  return { userId: row.id, email, role };
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  store = new PrismaSupportStore(testDb.db);
}, 60_000);
afterAll(async () => testDb.close());

beforeEach(async () => {
  await testDb.reset();
  now = new Date("2026-03-01T12:00:00.000Z");
  audits.length = 0;
  const customers = new PrismaCustomerStore(testDb.db);
  alice = await customers.createCustomer({ phone: "+989121234567", termsVersion: "2026-01", now });
  bob = await customers.createCustomer({ phone: "+989351234567", termsVersion: "2026-01", now });
  agent = await actor("agent@example.com", "support");
  editor = await actor("editor@example.com", "editor");
  viewer = await actor("viewer@example.com", "viewer");
  owner = await actor("owner@example.com", "owner");
  svc = new SupportService(store, new RateLimiter(() => now.getTime()), async (e) => void audits.push(e), undefined, () => now);
});

describe("customer tickets", () => {
  it("creates a ticket with its first message and shows only customer-safe data", async () => {
    const t = await svc.createTicket(alice, create());
    expect(t).toMatchObject({ subject: "سفارش نرسیده", category: "order", status: "open", orderNumber: null });
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0]).toMatchObject({ author: "customer" });
    expect(Object.keys(t).sort()).toEqual(["category", "createdAt", "lastMessageAt", "messages", "number", "orderNumber", "status", "subject"]);
    expect(Object.keys(t.messages[0]!).sort()).toEqual(["author", "body", "createdAt", "id"]);
  });

  it("links an order only when it belongs to the customer (same error for someone else's and unknown)", async () => {
    const vendorId = await ensureDefaultVendor(testDb.db);
    const p = await testDb.db.product.create({ data: { vendorId, slug: "p", name: "p", fulfillment: "unique", inventory: 1, searchText: "p" } });
    const accounts = new PrismaAccountStore(testDb.db);
    const o = await accounts.createOrder(
      {
        customerId: alice.id,
        items: [{ productId: p.id, vendorId, titleSnapshot: "p", skuSnapshot: null, variantSnapshot: null, imageKeySnapshot: null, unitPriceToman: 1000, quantity: 1 }],
        shipping: { recipientName: "علی", recipientPhone: "+989121234567", province: "تهران", city: "تهران", street: "خیابان ولیعصر", plaque: null, unit: null, postalCode: "1459813176" },
        customerNote: null,
        totalToman: 1000,
      },
      now,
    );
    expect((await svc.createTicket(alice, create({ orderNumber: o.number }))).orderNumber).toBe(o.number);
    expect(await fail(svc.createTicket(bob, create({ orderNumber: o.number })))).toMatchObject({ code: "invalid_order" });
    expect(await fail(svc.createTicket(bob, create({ orderNumber: 999 })))).toMatchObject({ code: "invalid_order" });
  });

  it("isolates customers: others' tickets are simply not found", async () => {
    const t = await svc.createTicket(alice, create());
    expect(await fail(svc.getCustomerTicket(bob.id, t.number))).toMatchObject({ code: "not_found" });
    expect(await fail(svc.customerReply(bob, t.number, "سلام من هم همین مشکل را دارم"))).toMatchObject({ code: "not_found" });
    expect((await svc.listCustomerTickets(bob.id, 1, 20)).total).toBe(0);
    expect((await svc.listCustomerTickets(alice.id, 1, 20)).total).toBe(1);
  });

  it("never exposes internal notes, staff identities or assignment to the customer", async () => {
    const t = await svc.createTicket(alice, create());
    await svc.addNote(agent, t.number, "SECRET-NOTE مشتری مشکوک است");
    await svc.reply(agent, t.number, "در حال بررسی هستیم");
    const seen = JSON.stringify(await svc.getCustomerTicket(alice.id, t.number));
    expect(seen).toContain("در حال بررسی هستیم");
    expect(seen).not.toMatch(/SECRET-NOTE|agent@example|adminId|assignedTo|priority/);
    expect(JSON.stringify(await svc.exportForCustomer(alice.id))).not.toMatch(/SECRET-NOTE|agent@example/);
  });

  it("follows the status workflow when the customer and staff reply", async () => {
    const t = await svc.createTicket(alice, create());
    await svc.reply(agent, t.number, "لطفا شماره پیگیری را بفرستید");
    expect((await svc.getCustomerTicket(alice.id, t.number)).status).toBe("waiting_customer");
    expect((await svc.customerReply(alice, t.number, "شماره پیگیری ۱۲۳۴۵ است")).status).toBe("open");
    await svc.reply(agent, t.number, "مشکل حل شد", "resolved");
    expect((await svc.customerReply(alice, t.number, "هنوز مشکل دارم")).status).toBe("open");
    await svc.updateTicket(agent, t.number, { status: "closed" });
    expect(await fail(svc.customerReply(alice, t.number, "یک پیام دیگر هم دارم"))).toMatchObject({ code: "ticket_closed" });
  });

  it("does not allow replying to a long-resolved ticket", async () => {
    const t = await svc.createTicket(alice, create());
    await svc.reply(agent, t.number, "حل شد", "resolved");
    now = new Date(now.getTime() + 15 * 24 * hour);
    expect(await fail(svc.customerReply(alice, t.number, "اما هنوز مشکل دارم"))).toMatchObject({ code: "reopen_expired" });
  });

  it("auto-closes tickets that stayed resolved", async () => {
    const t = await svc.createTicket(alice, create());
    await svc.reply(agent, t.number, "حل شد", "resolved");
    expect(await svc.autoCloseResolved()).toBe(0);
    now = new Date(now.getTime() + 8 * 24 * hour);
    expect(await svc.autoCloseResolved()).toBe(1);
    expect((await svc.getCustomerTicket(alice.id, t.number)).status).toBe("closed");
  });
});

describe("spam and abuse protection", () => {
  it("rate limits ticket creation per hour and per day", async () => {
    for (let i = 0; i < 3; i++) await svc.createTicket(alice, create({ subject: `موضوع ${i}`, body: `متن شماره ${i} برای بررسی مشکل سفارش` }));
    expect(await fail(svc.createTicket(alice, create({ subject: "بیشتر", body: "یک متن کاملا متفاوت و بلند" })))).toMatchObject({ code: "rate_limited" });
    // another customer is unaffected
    await expect(svc.createTicket(bob, create())).resolves.toBeTruthy();
    for (let day = 0; day < 1; day++) {
      for (let i = 0; i < 5; i++) {
        now = new Date(now.getTime() + 61 * 60_000);
        await svc.createTicket(alice, create({ subject: `روز ${i}`, body: `پیام روزانه شماره ${i} درباره مشکل` }));
      }
    }
    now = new Date(now.getTime() + 61 * 60_000);
    expect(await fail(svc.createTicket(alice, create({ subject: "حد روزانه", body: "این پیام باید رد شود چون سقف روزانه پر است" })))).toMatchObject({ code: "rate_limited" });
  });

  it("limits tickets that stay open at the same time", async () => {
    for (let i = 0; i < 10; i++) {
      now = new Date(now.getTime() + 3 * hour);
      if (i % 3 === 0) now = new Date(now.getTime() + 24 * hour); // stay under the daily rate limit
      await svc.createTicket(alice, create({ subject: `باز ${i}`, body: `تیکت باز شماره ${i} که بسته نمی‌شود` }));
    }
    now = new Date(now.getTime() + 24 * hour);
    expect(await fail(svc.createTicket(alice, create({ subject: "یازدهم", body: "تیکت یازدهم که نباید ساخته شود" })))).toMatchObject({ code: "too_many_open" });
  });

  it("refuses duplicate submissions, spammy bodies and suspended accounts", async () => {
    await svc.createTicket(alice, create());
    expect(await fail(svc.createTicket(alice, create()))).toMatchObject({ code: "duplicate" });
    expect(await fail(svc.createTicket(alice, create({ subject: "سفارش  نرسیده", body: "سفارش من هنوز به دستم نرسیده است، لطفا بررسی کنید!!" })))).toMatchObject({ code: "duplicate" });
    expect(await fail(svc.createTicket(alice, create({ body: "http://a.com http://b.com http://c.com را ببینید" })))).toMatchObject({ code: "spam" });
    expect(await fail(svc.createTicket({ id: alice.id, suspended: true }, create({ subject: "جدید", body: "متنی کاملا متفاوت و معتبر" })))).toMatchObject({ code: "account_suspended" });
  });

  it("refuses an identical repeated reply and floods of replies", async () => {
    const t = await svc.createTicket(alice, create());
    now = new Date(now.getTime() + 1000); // messages are ordered by time; keep them distinct
    await svc.customerReply(alice, t.number, "پیام اضافه شماره یک");
    now = new Date(now.getTime() + 1000);
    expect(await fail(svc.customerReply(alice, t.number, "پیام اضافه شماره یک"))).toMatchObject({ code: "duplicate" });
    let limited = 0;
    for (let i = 0; i < 10; i++) if ((await fail(svc.customerReply(alice, t.number, `پیام متفاوت شماره ${i} برای تست`)))?.code === "rate_limited") limited++;
    expect(limited).toBeGreaterThan(0);
  });

  it("enforces the hourly message budget from the database (survives restarts)", async () => {
    const t = await svc.createTicket(alice, create());
    for (let i = 0; i < 19; i++) {
      now = new Date(now.getTime() + 20_000);
      await svc.customerReply(alice, t.number, `پیام شماره ${i} برای بررسی بودجه ساعتی`);
    }
    now = new Date(now.getTime() + 20_000);
    expect(await fail(svc.customerReply(alice, t.number, "پیام بیستم و یکم"))).toMatchObject({ code: "rate_limited" });
  });
});

describe("role-based access (staff)", () => {
  it("lets support work tickets; editors and viewers cannot see conversations", async () => {
    const t = await svc.createTicket(alice, create());
    await expect(svc.listTickets(agent, list())).resolves.toMatchObject({ total: 1 });
    for (const who of [editor, viewer]) {
      expect(await fail(svc.listTickets(who, list()))).toMatchObject({ code: "forbidden" });
      expect(await fail(svc.getTicket(who, t.number))).toMatchObject({ code: "forbidden" });
      expect(await fail(svc.reply(who, t.number, "پاسخ"))).toMatchObject({ code: "forbidden" });
      expect(await fail(svc.addNote(who, t.number, "یادداشت"))).toMatchObject({ code: "forbidden" });
      expect(await fail(svc.updateTicket(who, t.number, { priority: "high" }))).toMatchObject({ code: "forbidden" });
    }
    await expect(svc.getTicket(owner, t.number)).resolves.toMatchObject({ number: t.number });
  });

  it("lists with masked phone numbers, filters and orders urgent first", async () => {
    const a = await svc.createTicket(alice, create({ subject: "اولی", body: "متن اول برای تیکت اول است" }));
    const b = await svc.createTicket(bob, create({ subject: "دومی ارسال", body: "متن دوم برای تیکت دوم است", category: "shipping" }));
    await svc.updateTicket(agent, b.number, { priority: "urgent" });
    const all = await svc.listTickets(agent, list());
    expect(all.items.map((x) => x.number)).toEqual([b.number, a.number]);
    expect(all.items[0]?.customerPhoneMasked).toBe("+98935***4567");
    expect(JSON.stringify(all)).not.toContain("+989351234567");
    expect((await svc.listTickets(agent, list({ category: "shipping" }))).total).toBe(1);
    expect((await svc.listTickets(agent, list({ q: `T-${1000 + a.number}` }))).items.map((x) => x.number)).toEqual([a.number]);
    expect((await svc.listTickets(agent, list({ q: "ارسال" }))).items.map((x) => x.number)).toEqual([b.number]);
    expect((await svc.listTickets(agent, list({ q: "%" }))).total).toBe(2); // wildcard characters are not special
    expect((await svc.listTickets(agent, list({ unassigned: "1" }))).total).toBe(2);
  });

  it("keeps internal notes separate, records first response and assignment, and audits actions", async () => {
    const t = await svc.createTicket(alice, create());
    await svc.addNote(agent, t.number, "تماس گرفته شد");
    await svc.reply(agent, t.number, "سلام، پیگیری می‌کنیم");
    const d = await svc.getTicket(agent, t.number);
    expect(d.notes).toMatchObject([{ body: "تماس گرفته شد", adminEmail: "agent@example.com" }]);
    expect(d.messages.map((m) => [m.author, m.adminEmail])).toEqual([["customer", null], ["staff", "agent@example.com"]]);
    expect(d).toMatchObject({ assignedToEmail: "agent@example.com", status: "waiting_customer" });
    expect(d.firstResponseAt).not.toBeNull();
    expect(audits.map((a) => a.action)).toEqual(["support.note", "support.reply"]);
    expect(JSON.stringify(audits)).not.toContain("سلام، پیگیری");
  });

  it("validates transitions and assignees", async () => {
    const t = await svc.createTicket(alice, create());
    await svc.updateTicket(agent, t.number, { status: "closed" });
    expect(await fail(svc.updateTicket(agent, t.number, { status: "resolved" }))).toMatchObject({ code: "invalid_transition" });
    expect(await fail(svc.reply(agent, t.number, "پاسخ"))).toMatchObject({ code: "ticket_closed" });
    await svc.updateTicket(agent, t.number, { status: "open", assignedToId: agent.userId, priority: "high" });
    expect(await fail(svc.updateTicket(agent, t.number, { assignedToId: viewer.userId }))).toMatchObject({ code: "invalid_assignee" });
    expect(await fail(svc.updateTicket(agent, t.number, { assignedToId: "nope" }))).toMatchObject({ code: "invalid_assignee" });
    await svc.updateTicket(agent, t.number, { assignedToId: null });
    expect(ticketUpdateSchema.safeParse({ assignedToId: "x", extra: 1 }).success).toBe(false);
    expect(await fail(svc.getTicket(agent, 9999))).toMatchObject({ code: "not_found" });
  });

  it("reports counts by status", async () => {
    await svc.createTicket(alice, create());
    expect(await svc.stats(agent)).toMatchObject({ open: 1, closed: 0 });
  });
});

describe("FAQ", () => {
  it("ships Persian starter content that validates, seeded unpublished and idempotently", async () => {
    for (const item of DEFAULT_FAQ.items) expect(faqItemSchema.safeParse(item).success, item.slug).toBe(true);
    expect(await svc.seedDefaultFaq()).toBe(DEFAULT_FAQ.items.length);
    expect(await svc.seedDefaultFaq()).toBe(0);
    expect(await svc.publicFaq()).toEqual([]); // nothing public until the owner publishes
  });

  it("publishes only published items and never overwrites an edited answer on re-seed", async () => {
    await svc.seedDefaultFaq();
    const item = DEFAULT_FAQ.items.find((i) => i.slug === "how-to-sign-in")!;
    await svc.saveFaqItem(editor, faqItemSchema.parse({ ...item, answer: "پاسخ ویرایش‌شده توسط مدیر", published: true }));
    await svc.seedDefaultFaq();
    const pub = await svc.publicFaq();
    expect(pub).toHaveLength(1);
    expect(pub[0]?.items).toEqual([{ slug: "how-to-sign-in", question: item.question, answer: "پاسخ ویرایش‌شده توسط مدیر" }]);
  });

  it("is writable by support, editor and owner, not viewer", async () => {
    const item = faqItemSchema.parse({ categorySlug: "account", slug: "x-item", question: "پرسش آزمایشی؟", answer: "پاسخ آزمایشی" });
    await svc.seedDefaultFaq();
    await expect(svc.saveFaqItem(agent, item)).resolves.toBeUndefined();
    expect(await fail(svc.saveFaqItem(viewer, item))).toMatchObject({ code: "forbidden" });
    expect(await fail(svc.saveFaqItem(owner, { ...item, categorySlug: "missing" }))).toMatchObject({ code: "not_found" });
    await svc.deleteFaqItem(owner, "x-item");
    expect(await fail(svc.deleteFaqItem(owner, "x-item"))).toMatchObject({ code: "not_found" });
  });
});

describe("account deletion interplay", () => {
  it("includes the customer's tickets in their export and redacts them on anonymisation", async () => {
    const customers = new PrismaCustomerStore(testDb.db);
    const accounts = new AccountService(new PrismaAccountStore(testDb.db), customers, undefined, () => now, (id) => svc.exportForCustomer(id));
    await svc.createTicket(alice, create({ body: "کد ملی من ۱۲۳ است و آدرسم فلان" }));
    const exported = await accounts.exportData(alice.id);
    expect(JSON.stringify(exported.support)).toContain("کد ملی من");
    await accounts.requestDeletion(alice.id);
    now = new Date(now.getTime() + 15 * 24 * hour);
    await accounts.runDeletions();
    const t = await testDb.db.supportTicket.findFirstOrThrow({ where: { customerId: alice.id }, include: { messages: true } });
    expect(JSON.stringify(t)).not.toMatch(/کد ملی|آدرسم|سفارش نرسیده/);
    expect(t.category).toBe("order");
  });
});

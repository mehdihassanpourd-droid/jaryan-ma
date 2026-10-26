/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted field by field */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLIENT_IP_HEADER, CSRF_HEADER } from "./api";
import { createTestDatabase, type TestDatabase } from "./db/test-database";
import { buildTestApp, call, CUSTOMER_COOKIE, STORE_ORIGIN, type TestApp } from "./testing/app";

let testDb: TestDatabase;
let app: TestApp;

beforeAll(async () => {
  testDb = await createTestDatabase();
}, 60_000);
afterAll(async () => testDb.close());
beforeEach(async () => {
  app = await buildTestApp(testDb);
});

const PHONE = "09121234567";
const E164 = "+989121234567";

interface CustomerSession {
  cookie: string;
  csrf: string;
}
interface CCall {
  method?: string;
  path: string;
  as?: CustomerSession | null;
  body?: unknown;
  origin?: string | null;
  csrf?: string | null;
  ip?: string;
}

async function ccall(c: CCall) {
  const method = c.method ?? "GET";
  const headers: Record<string, string> = { [CLIENT_IP_HEADER]: c.ip ?? "198.51.100.5" };
  if (c.as) headers.cookie = c.as.cookie;
  if (method !== "GET") {
    if (c.origin !== null) headers.origin = c.origin ?? STORE_ORIGIN;
    const csrf = c.csrf === undefined ? c.as?.csrf : c.csrf;
    if (csrf) headers[CSRF_HEADER] = csrf;
  }
  let body: string | undefined;
  if (c.body !== undefined) {
    body = JSON.stringify(c.body);
    headers["content-type"] = "application/json";
  }
  const res = await app.customerApi(new Request(`https://api.example.test${c.path}`, { method, headers, body }));
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any, res };
}

async function signIn(phone = PHONE, e164 = E164, ip = "198.51.100.5"): Promise<CustomerSession> {
  expect((await ccall({ method: "POST", path: "/api/v1/customer/auth/request-code", body: { phone }, ip })).status).toBe(202);
  const code = app.sms.lastCode(e164)!;
  const r = await ccall({ method: "POST", path: "/api/v1/customer/auth/verify", body: { phone, code, acceptTerms: true }, ip });
  expect(r.status).toBe(200);
  const token = /jm_c=([^;]+)/.exec(r.res.headers.get("set-cookie") ?? "")?.[1];
  return { cookie: `${CUSTOMER_COOKIE}=${token}`, csrf: r.body.csrfToken };
}

const ADDRESS = { recipientName: "علی رضایی", recipientPhone: "09121234567", province: "تهران", city: "تهران", street: "خیابان ولیعصر، کوچه گل", postalCode: "1459813176" };

describe("customer sign-in over HTTP", () => {
  it("registers with an SMS code, sets a locked-down cookie and returns the profile", async () => {
    await ccall({ method: "POST", path: "/api/v1/customer/auth/request-code", body: { phone: "۰۹۱۲۱۲۳۴۵۶۷" } });
    const code = app.sms.lastCode(E164)!;
    const r = await ccall({ method: "POST", path: "/api/v1/customer/auth/verify", body: { phone: PHONE, code, acceptTerms: true } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ isNewCustomer: true, customer: { phone: E164, status: "active" } });
    const cookie = r.res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^jm_c=[\w-]{40,}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+; Secure$/);
    expect(JSON.stringify(r.body)).not.toMatch(/tokenHash|codeHash/);
  });

  it("answers the same for registered and unknown numbers and never reveals the code", async () => {
    const a = await ccall({ method: "POST", path: "/api/v1/customer/auth/request-code", body: { phone: PHONE } });
    await signIn("09351234567", "+989351234567", "198.51.100.9");
    app.advance(61_000); // past the per-number cooldown, which applies to any number alike
    const b = await ccall({ method: "POST", path: "/api/v1/customer/auth/request-code", body: { phone: "09351234567" }, ip: "198.51.100.10" });
    expect(a.status).toBe(b.status);
    expect(Object.keys(a.body)).toEqual(Object.keys(b.body));
    expect(JSON.stringify(a.body)).not.toMatch(/\d{6}/);
  });

  it("requires terms for a new number, rejects bad codes uniformly and malformed phones", async () => {
    await ccall({ method: "POST", path: "/api/v1/customer/auth/request-code", body: { phone: PHONE } });
    const code = app.sms.lastCode(E164)!;
    expect((await ccall({ method: "POST", path: "/api/v1/customer/auth/verify", body: { phone: PHONE, code } })).body.error).toBe("terms_required");
    const wrong = await ccall({ method: "POST", path: "/api/v1/customer/auth/verify", body: { phone: PHONE, code: code === "000000" ? "111111" : "000000", acceptTerms: true } });
    expect(wrong).toMatchObject({ status: 401, body: { error: "invalid_code" } });
    expect((await ccall({ method: "POST", path: "/api/v1/customer/auth/request-code", body: { phone: "12345" } })).status).toBe(422);
    expect((await ccall({ method: "POST", path: "/api/v1/customer/auth/request-code", body: { phone: PHONE, extra: 1 } })).status).toBe(422);
  });

  it("rate limits code requests", async () => {
    await ccall({ method: "POST", path: "/api/v1/customer/auth/request-code", body: { phone: PHONE } });
    const again = await ccall({ method: "POST", path: "/api/v1/customer/auth/request-code", body: { phone: PHONE } });
    expect(again.status).toBe(429);
    expect(again.res.headers.get("retry-after")).toBeTruthy();
  });

  it("is a 404 everywhere when the feature is switched off", async () => {
    app = await buildTestApp(testDb, { customerAccountsEnabled: false });
    expect((await ccall({ method: "POST", path: "/api/v1/customer/auth/request-code", body: { phone: PHONE } })).status).toBe(404);
    expect(app.sms.sent).toHaveLength(0);
    expect((await ccall({ path: "/api/v1/public/faq" })).status).toBe(200); // public FAQ stays available
  });

  it("signs out and invalidates the session", async () => {
    const s = await signIn();
    expect((await ccall({ path: "/api/v1/customer/me", as: s })).status).toBe(200);
    expect((await ccall({ method: "POST", path: "/api/v1/customer/auth/logout", as: s })).status).toBe(200);
    expect((await ccall({ path: "/api/v1/customer/me", as: s })).status).toBe(401);
  });
});

describe("request protection", () => {
  it("rejects writes without an allowed Origin, without the CSRF token, and unauthenticated access", async () => {
    const s = await signIn();
    expect((await ccall({ method: "PATCH", path: "/api/v1/customer/me", as: s, body: { firstName: "علی" }, origin: "https://evil.example" })).body.error).toBe("bad_origin");
    expect((await ccall({ method: "PATCH", path: "/api/v1/customer/me", as: s, body: { firstName: "علی" }, origin: null })).body.error).toBe("bad_origin");
    expect((await ccall({ method: "PATCH", path: "/api/v1/customer/me", as: s, body: { firstName: "علی" }, csrf: null })).body.error).toBe("bad_csrf_token");
    expect((await ccall({ method: "PATCH", path: "/api/v1/customer/me", as: s, body: { firstName: "علی" }, csrf: "wrong" })).body.error).toBe("bad_csrf_token");
    expect((await ccall({ path: "/api/v1/customer/addresses" })).status).toBe(401);
    expect((await ccall({ path: "/api/v1/customer/addresses", as: { cookie: "jm_c=garbage", csrf: "x" } })).status).toBe(401);
  });

  it("an admin session is not a customer session and vice versa", async () => {
    const admin = await app.session("owner");
    const customer = await signIn();
    expect((await ccall({ path: "/api/v1/customer/me", as: { cookie: admin.cookie, csrf: admin.csrf } })).status).toBe(401);
    expect((await call(app, { path: "/api/v1/products", as: { cookie: customer.cookie, csrf: customer.csrf } })).status).toBe(401);
  });

  it("sends CORS headers only for the storefront origin", async () => {
    const s = await signIn();
    const ok = await app.customerApi(new Request("https://api.example.test/api/v1/customer/me", { headers: { cookie: s.cookie, origin: STORE_ORIGIN, [CLIENT_IP_HEADER]: "198.51.100.5" } }));
    expect(ok.headers.get("access-control-allow-origin")).toBe(STORE_ORIGIN);
    expect(ok.headers.get("access-control-allow-credentials")).toBe("true");
    const evil = await app.customerApi(new Request("https://api.example.test/api/v1/customer/me", { headers: { cookie: s.cookie, origin: "https://evil.example", [CLIENT_IP_HEADER]: "198.51.100.5" } }));
    expect(evil.status).toBe(403);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await app.customerApi(new Request("https://api.example.test/api/v1/customer/me", { method: "OPTIONS", headers: { origin: STORE_ORIGIN } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-headers")).toContain("x-csrf-token");
    const badPre = await app.customerApi(new Request("https://api.example.test/api/v1/customer/me", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(badPre.status).toBe(403);
  });
});

describe("customer account over HTTP", () => {
  it("manages profile, addresses and favourites", async () => {
    const s = await signIn();
    const patched = await ccall({ method: "PATCH", path: "/api/v1/customer/me", as: s, body: { firstName: "علی", email: "ali@example.com" } });
    expect(patched.body.customer).toMatchObject({ firstName: "علی", email: "ali@example.com" });
    expect((await ccall({ method: "PATCH", path: "/api/v1/customer/me", as: s, body: { status: "suspended" } })).status).toBe(422);
    expect((await ccall({ method: "PATCH", path: "/api/v1/customer/me", as: s, body: { phone: "09350000000" } })).status).toBe(422);

    const a = await ccall({ method: "POST", path: "/api/v1/customer/addresses", as: s, body: ADDRESS });
    expect(a.status).toBe(201);
    expect(a.body.address).toMatchObject({ isDefault: true, postalCode: "1459813176" });
    expect((await ccall({ method: "POST", path: "/api/v1/customer/addresses", as: s, body: { ...ADDRESS, postalCode: "123" } })).status).toBe(422);
    expect((await ccall({ method: "PUT", path: `/api/v1/customer/addresses/${a.body.address.id}`, as: s, body: { ...ADDRESS, city: "کرج" } })).body.address.city).toBe("کرج");
    expect((await ccall({ method: "DELETE", path: `/api/v1/customer/addresses/${a.body.address.id}`, as: s })).status).toBe(200);
    expect((await ccall({ method: "DELETE", path: `/api/v1/customer/addresses/${a.body.address.id}`, as: s })).status).toBe(404);

    const vendor = await testDb.db.vendor.findFirstOrThrow();
    await testDb.db.product.create({ data: { vendorId: vendor.id, slug: "basket", name: "سبد", fulfillment: "unique", inventory: 1, status: "published", searchText: "سبد" } });
    expect((await ccall({ method: "PUT", path: "/api/v1/customer/favorites/basket", as: s })).body.result).toBe("added");
    expect((await ccall({ method: "PUT", path: "/api/v1/customer/favorites/missing", as: s })).status).toBe(404);
    expect((await ccall({ path: "/api/v1/customer/favorites", as: s })).body).toMatchObject({ total: 1, items: [{ slug: "basket" }] });
    expect((await ccall({ method: "DELETE", path: "/api/v1/customer/favorites/basket", as: s })).status).toBe(200);
  });

  it("keeps customers apart", async () => {
    const alice = await signIn();
    const bob = await signIn("09351234567", "+989351234567", "198.51.100.9");
    const a = await ccall({ method: "POST", path: "/api/v1/customer/addresses", as: alice, body: ADDRESS });
    expect((await ccall({ method: "DELETE", path: `/api/v1/customer/addresses/${a.body.address.id}`, as: bob })).status).toBe(404);
    expect((await ccall({ path: "/api/v1/customer/addresses", as: bob })).body.addresses).toEqual([]);
    const t = await ccall({ method: "POST", path: "/api/v1/customer/support/tickets", as: alice, body: { subject: "مشکل سفارش", body: "سفارش من هنوز نرسیده است لطفا پیگیری کنید" } });
    expect((await ccall({ path: `/api/v1/customer/support/tickets/${t.body.ticket.number}`, as: bob })).status).toBe(404);
    expect((await ccall({ method: "POST", path: `/api/v1/customer/support/tickets/${t.body.ticket.number}/reply`, as: bob, body: { body: "پیام من" } })).status).toBe(404);
  });

  it("exports data and walks through account deletion", async () => {
    const s = await signIn();
    await ccall({ method: "POST", path: "/api/v1/customer/addresses", as: s, body: ADDRESS });
    const exp = await ccall({ method: "POST", path: "/api/v1/customer/account/export", as: s });
    expect(exp.status).toBe(200);
    expect(exp.res.headers.get("content-disposition")).toContain("attachment");
    expect(exp.body).toMatchObject({ formatVersion: 1, profile: { phone: E164 }, addresses: [{ postalCode: "1459813176" }] });
    expect(JSON.stringify(exp.body)).not.toMatch(/tokenHash|csrfToken|codeHash/);
    expect((await ccall({ method: "POST", path: "/api/v1/customer/account/export", as: s })).status).toBe(429);

    expect((await ccall({ method: "POST", path: "/api/v1/customer/account/delete", as: s })).status).toBe(200);
    expect((await ccall({ path: "/api/v1/customer/me", as: s })).body.customer.status).toBe("pending_deletion");
    expect((await ccall({ method: "POST", path: "/api/v1/customer/account/delete/cancel", as: s })).status).toBe(200);
    expect((await ccall({ method: "POST", path: "/api/v1/customer/account/delete/cancel", as: s })).status).toBe(409);
    await ccall({ method: "POST", path: "/api/v1/customer/account/delete", as: s });
    app.advance(15 * 24 * 3600_000);
    expect(await app.platform.accounts.runDeletions()).toBe(1);
    expect((await ccall({ path: "/api/v1/customer/me", as: s })).status).toBe(401);
  });
});

describe("support over HTTP: customer and staff", () => {
  it("runs a conversation end to end with role checks and without leaking internal notes", async () => {
    const s = await signIn();
    const created = await ccall({ method: "POST", path: "/api/v1/customer/support/tickets", as: s, body: { subject: "سفارش نرسیده", body: "سفارش من هنوز نرسیده است لطفا پیگیری کنید", category: "order" } });
    expect(created.status).toBe(201);
    const n = created.body.ticket.number;
    expect((await ccall({ method: "POST", path: "/api/v1/customer/support/tickets", as: s, body: { subject: "x", body: "کوتاه", priority: "urgent" } })).status).toBe(422);

    const support = await app.session("support");
    const list = await call(app, { path: "/api/v1/support/tickets", as: support });
    expect(list.body).toMatchObject({ total: 1, items: [{ number: n, status: "open", customerPhoneMasked: "+98912***4567" }] });
    expect(JSON.stringify(list.body)).not.toContain(E164);

    expect((await call(app, { method: "POST", path: `/api/v1/support/tickets/${n}/notes`, as: support, body: { body: "INTERNAL-ONLY مشتری ناراضی" } })).status).toBe(201);
    expect((await call(app, { method: "POST", path: `/api/v1/support/tickets/${n}/reply`, as: support, body: { body: "سلام، در حال پیگیری هستیم" } })).status).toBe(201);
    expect((await call(app, { method: "PATCH", path: `/api/v1/support/tickets/${n}`, as: support, body: { priority: "high" } })).status).toBe(200);

    const staffView = await call(app, { path: `/api/v1/support/tickets/${n}`, as: support });
    expect(staffView.body.ticket).toMatchObject({ status: "waiting_customer", priority: "high", notes: [{ body: expect.stringContaining("INTERNAL-ONLY") }] });

    const customerView = await ccall({ path: `/api/v1/customer/support/tickets/${n}`, as: s });
    expect(customerView.body.ticket.messages.map((m: any) => m.author)).toEqual(["customer", "staff"]);
    expect(JSON.stringify(customerView.body)).not.toMatch(/INTERNAL-ONLY|support@example|priority|assigned/);
    const reply = await ccall({ method: "POST", path: `/api/v1/customer/support/tickets/${n}/reply`, as: s, body: { body: "ممنون، منتظر می‌مانم" } });
    expect(reply.body.ticket.status).toBe("open");

    expect(await testDb.db.auditLog.count({ where: { entity: "ticket" } })).toBeGreaterThanOrEqual(3);
  });

  it("enforces roles on the staff endpoints and CSRF/Origin on writes", async () => {
    const s = await signIn();
    const created = await ccall({ method: "POST", path: "/api/v1/customer/support/tickets", as: s, body: { subject: "سفارش نرسیده", body: "سفارش من هنوز نرسیده است لطفا پیگیری کنید" } });
    const n = created.body.ticket.number;
    for (const role of ["viewer", "editor"] as const) {
      const who = await app.session(role);
      expect((await call(app, { path: "/api/v1/support/tickets", as: who })).status).toBe(403);
      expect((await call(app, { path: `/api/v1/support/tickets/${n}`, as: who })).status).toBe(403);
      expect((await call(app, { method: "POST", path: `/api/v1/support/tickets/${n}/reply`, as: who, body: { body: "پاسخ" } })).status).toBe(403);
    }
    const support = await app.session("support");
    expect((await call(app, { method: "POST", path: `/api/v1/support/tickets/${n}/reply`, as: support, body: { body: "پاسخ" }, csrf: null })).status).toBe(403);
    expect((await call(app, { method: "POST", path: `/api/v1/support/tickets/${n}/reply`, as: support, body: { body: "پاسخ" }, origin: "https://evil.example" })).status).toBe(403);
    expect((await call(app, { path: "/api/v1/support/tickets" })).status).toBe(401);
    expect((await call(app, { path: "/api/v1/maintenance/health", as: support })).status).toBe(403);
  });

  it("the support role can maintain the FAQ; the public FAQ shows only published answers", async () => {
    const support = await app.session("support");
    expect((await call(app, { method: "POST", path: "/api/v1/faq/seed", as: support })).body.created).toBeGreaterThan(5);
    expect((await ccall({ path: "/api/v1/public/faq" })).body.categories).toEqual([]);
    const item = { categorySlug: "account", slug: "how-to-sign-in", question: "چگونه وارد شوم؟", answer: "با کد پیامکی وارد شوید.", published: true };
    expect((await call(app, { method: "PUT", path: "/api/v1/faq/items", as: support, body: item })).status).toBe(200);
    const pub = await ccall({ path: "/api/v1/public/faq" });
    expect(pub.res.headers.get("access-control-allow-origin")).toBe("*");
    expect(pub.res.headers.get("cache-control")).toContain("max-age=300");
    expect(pub.body.categories).toEqual([{ slug: "account", title: "حساب کاربری", items: [{ slug: "how-to-sign-in", question: "چگونه وارد شوم؟", answer: "با کد پیامکی وارد شوید." }] }]);
    expect((await call(app, { method: "PUT", path: "/api/v1/faq/items", as: support, body: { ...item, categorySlug: "nope" } })).status).toBe(404);
    const viewer = await app.session("viewer");
    expect((await call(app, { method: "PUT", path: "/api/v1/faq/items", as: viewer, body: item })).status).toBe(403);
  });
});

describe("maintenance over HTTP", () => {
  it("only the owner can use the maintenance endpoints", async () => {
    const owner = await app.session("owner");
    for (const role of ["viewer", "editor", "support"] as const) {
      const who = await app.session(role);
      for (const path of ["/maintenance/health", "/maintenance/incidents", "/maintenance/backups", "/maintenance/errors", "/maintenance/log", "/maintenance/backup-status"]) {
        expect((await call(app, { path: `/api/v1${path}`, as: who })).status, `${role} ${path}`).toBe(403);
      }
    }
    expect((await call(app, { path: "/api/v1/maintenance/health", as: owner })).body.status).toBe("degraded"); // backup never tested
  });

  it("records a backup and its restore test, and reports operational only afterwards", async () => {
    const owner = await app.session("owner");
    const backup = { kind: "database", takenAt: app.now().toISOString(), sizeBytes: 2048, location: "/srv/backups/db.dump.enc", encrypted: true };
    const rec = await call(app, { method: "POST", path: "/api/v1/maintenance/backups", as: owner, body: { ...backup, takenAt: new Date(app.now().getTime() - 60_000).toISOString() } });
    expect(rec.status).toBe(201);
    expect((await call(app, { path: "/api/v1/maintenance/backup-status", as: owner })).body.database).toMatchObject({ state: "untested", operational: false });
    const tested = await call(app, { method: "POST", path: `/api/v1/maintenance/backups/${rec.body.backup.id}/restore-test`, as: owner, body: { ok: true, notes: "restored into scratch database" } });
    expect(tested.body.backupStatus.database).toMatchObject({ state: "operational", operational: true });
    expect((await call(app, { path: "/api/v1/maintenance/health", as: owner })).body.status).toBe("ok");
    expect((await call(app, { method: "POST", path: "/api/v1/maintenance/backups", as: owner, body: { ...backup, takenAt: "2099-01-01T00:00:00Z" } })).status).toBe(422);
    expect((await call(app, { method: "POST", path: "/api/v1/maintenance/backups", as: owner, body: { ...backup, sha256: "nothex" } })).status).toBe(422);
  });

  it("tracks incidents and exposes the maintenance log", async () => {
    const owner = await app.session("owner");
    const inc = await call(app, { method: "POST", path: "/api/v1/maintenance/incidents", as: owner, body: { title: "اختلال پیامک", severity: "major" } });
    expect(inc.status).toBe(201);
    const n = inc.body.incident.number;
    expect((await call(app, { method: "POST", path: `/api/v1/maintenance/incidents/${n}/updates`, as: owner, body: { status: "resolved", message: "رفع شد" } })).status).toBe(201);
    expect((await call(app, { method: "POST", path: `/api/v1/maintenance/incidents/${n}/updates`, as: owner, body: { status: "monitoring", message: "x" } })).status).toBe(409);
    expect((await call(app, { path: `/api/v1/maintenance/incidents/${n}`, as: owner })).body.incident.updates).toHaveLength(2);
    expect((await call(app, { path: "/api/v1/maintenance/log", as: owner })).body.log.map((l: any) => l.action)).toContain("incident.create");
  });
});

describe("public health and client error reports", () => {
  it("/health reveals only the status", async () => {
    const r = await ccall({ path: "/health" });
    expect(Object.keys(r.body).sort()).toEqual(["checkedAt", "status"]);
    expect(JSON.stringify(r.body)).not.toMatch(/database|storage|backup/);
  });

  it("accepts sanitised, rate-limited storefront error reports", async () => {
    const report = { name: "TypeError", message: "failed for ali@example.com 09121234567", stack: "TypeError\n    at x (https://shop.example.test/a.js:1:1)", url: "https://shop.example.test/p?token=SECRET" };
    expect((await ccall({ method: "POST", path: "/api/v1/public/client-errors", body: report })).status).toBe(204);
    expect((await ccall({ method: "POST", path: "/api/v1/public/client-errors", body: report, origin: "https://evil.example" })).status).toBe(403);
    expect((await ccall({ method: "POST", path: "/api/v1/public/client-errors", body: { ...report, extra: 1 } })).status).toBe(422);
    const owner = await app.session("owner");
    const errors = await call(app, { path: "/api/v1/maintenance/errors", as: owner });
    expect(errors.body.errors).toHaveLength(1);
    expect(JSON.stringify(errors.body)).not.toMatch(/ali@example|09121234567|SECRET/);
    expect(errors.body.errors[0]).toMatchObject({ source: "storefront", count: 1 });
    let limited = 0;
    for (let i = 0; i < 40; i++) if ((await ccall({ method: "POST", path: "/api/v1/public/client-errors", body: report })).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
  });
});

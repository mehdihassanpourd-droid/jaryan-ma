import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_OTP_POLICY, type OtpPolicy } from "../../src/domain/customer/otp-policy";
import { RateLimiter } from "../auth/rate-limit";
import { sha256Hex } from "../auth/session";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { MemorySmsProvider, SmsNotConfiguredError } from "../sms/provider";
import { CustomerAuthFailure, CustomerAuthService, CustomerSessionAuthenticator, DEFAULT_CUSTOMER_AUTH } from "./customer-auth";
import { OtpFailure, OtpService } from "./otp-service";
import { PrismaCustomerStore } from "./prisma-store";

const PHONE = "+989121234567";
const OTHER = "+989351234567";
const IP = "203.0.113.7";

let testDb: TestDatabase;
let store: PrismaCustomerStore;
let sms: MemorySmsProvider;
let key: Buffer;
let now: Date;
let otp: OtpService;
let auth: CustomerAuthService;
let authenticator: CustomerSessionAuthenticator;
const logs: Array<{ event: string; detail?: Record<string, unknown> }> = [];

const advance = (ms: number) => void (now = new Date(now.getTime() + ms));
const min = (n: number) => n * 60_000;

function build(policy: OtpPolicy = DEFAULT_OTP_POLICY, smsProvider = sms) {
  otp = new OtpService(store, smsProvider, key, policy, () => now, (event, detail) => void logs.push({ event, detail }));
  auth = new CustomerAuthService(store, otp, new RateLimiter(() => now.getTime()), DEFAULT_CUSTOMER_AUTH, () => now);
  authenticator = new CustomerSessionAuthenticator(store, { name: "jm_c", secure: true }, { idleMs: DEFAULT_CUSTOMER_AUTH.sessionIdleMs }, () => now);
}

const fail = async <T>(p: Promise<T>) => (await p.then(() => null, (e: unknown) => e)) as CustomerAuthFailure | OtpFailure | null;
const requestWith = (token: string) => new Request("https://api.example.test/x", { headers: { cookie: `jm_c=${token}` } });
const signIn = (over: Partial<Parameters<CustomerAuthService["signIn"]>[0]> = {}) =>
  auth.signIn({ phone: PHONE, code: sms.lastCode(PHONE) ?? "000000", acceptTerms: true, ip: IP, userAgent: "vitest", ...over });

beforeAll(async () => {
  testDb = await createTestDatabase();
  store = new PrismaCustomerStore(testDb.db);
}, 60_000);
afterAll(async () => testDb.close());

beforeEach(async () => {
  await testDb.reset();
  now = new Date("2026-03-01T12:00:00.000Z");
  sms = new MemorySmsProvider();
  key = randomBytes(32);
  logs.length = 0;
  build();
});

describe("requesting a code", () => {
  it("sends a 6-digit code by SMS and stores only a keyed hash of it", async () => {
    expect(await auth.requestCode(PHONE, IP)).toEqual({ retryAfterSeconds: 60 });
    const code = sms.lastCode(PHONE)!;
    expect(code).toMatch(/^\d{6}$/);
    expect(sms.sent[0]?.text).toContain("به هیچ‌کس نگویید");
    const row = await testDb.db.customerOtp.findFirstOrThrow();
    expect(row).toMatchObject({ phone: PHONE, ip: IP, attempts: 0, providerMessageId: "mem-1" });
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.expiresAt.getTime() - now.getTime()).toBe(300_000);
  });

  it("gives the same answer for registered and unregistered numbers", async () => {
    await auth.requestCode(PHONE, IP);
    await signIn();
    advance(min(2));
    const registered = await auth.requestCode(PHONE, IP);
    const unregistered = await auth.requestCode(OTHER, IP);
    expect(registered).toEqual(unregistered);
  });

  it("enforces the cooldown, the 15-minute window and the daily limit per number", async () => {
    await auth.requestCode(PHONE, IP);
    expect(await fail(auth.requestCode(PHONE, IP))).toMatchObject({ code: "rate_limited", retryAfterSeconds: 60 });
    advance(60_000);
    await auth.requestCode(PHONE, IP);
    advance(60_000);
    await auth.requestCode(PHONE, IP);
    advance(60_000);
    expect(await fail(auth.requestCode(PHONE, IP))).toMatchObject({ code: "rate_limited", retryAfterSeconds: 720 });
    advance(min(16));
    await auth.requestCode(PHONE, IP);
    expect(sms.sent).toHaveLength(4);
  });

  it("limits one client address across many numbers", async () => {
    for (let i = 0; i < 20; i++) await auth.requestCode(`+98912000${String(1000 + i)}`, IP);
    expect(await fail(auth.requestCode(OTHER, IP))).toMatchObject({ code: "rate_limited" });
    await auth.requestCode(OTHER, "198.51.100.9"); // another address is unaffected
  });

  it("stops sending when the site-wide daily budget is used up (SMS-pumping protection) and says so", async () => {
    build({ ...DEFAULT_OTP_POLICY, dailyBudget: 3, ipMax: 100 });
    for (let i = 0; i < 3; i++) await auth.requestCode(`+98912000${String(2000 + i)}`, `10.0.0.${i}`);
    expect(await fail(auth.requestCode(OTHER, "10.0.1.1"))).toMatchObject({ code: "sms_unavailable" });
    expect(sms.sent).toHaveLength(3);
    expect(logs.map((l) => l.event)).toContain("sms_budget_exhausted");
    advance(24 * 3600_000 + 1000);
    await auth.requestCode(OTHER, "10.0.1.1"); // the budget is per rolling 24 hours
  });

  it("reports provider failures without leaking details, and invalidates the unsent code", async () => {
    sms.failNext = new Error("gateway password=hunter2");
    const error = await fail(auth.requestCode(PHONE, IP));
    expect(error).toMatchObject({ code: "sms_unavailable" });
    expect(JSON.stringify(logs)).not.toContain("hunter2");
    expect(await testDb.db.customerOtp.count({ where: { invalidatedAt: null } })).toBe(0);
    advance(60_000);
    await auth.requestCode(PHONE, IP);
    expect((await signIn()).isNewCustomer).toBe(true);
  });

  it("cannot sign anyone in when no SMS provider is configured (no fake authentication)", async () => {
    const disabled = { name: "none", send: async () => { throw new SmsNotConfiguredError(); } };
    build(DEFAULT_OTP_POLICY, disabled as unknown as MemorySmsProvider);
    expect(await fail(auth.requestCode(PHONE, IP))).toMatchObject({ code: "sms_unavailable" });
    expect(await fail(signIn({ code: "123456" }))).toMatchObject({ code: "invalid_code" });
    expect(await testDb.db.customer.count()).toBe(0);
    expect(logs.find((l) => l.event === "sms_send_failed")?.detail).toMatchObject({ reason: "not_configured" });
  });

  it("only the newest code is valid", async () => {
    await auth.requestCode(PHONE, IP);
    const first = sms.lastCode(PHONE)!;
    advance(60_000);
    await auth.requestCode(PHONE, IP);
    const second = sms.lastCode(PHONE)!;
    if (first !== second) expect(await fail(signIn({ code: first }))).toMatchObject({ code: "invalid_code" });
    expect((await signIn({ code: second })).customer.phone).toBe(PHONE);
  });
});

describe("checking a code", () => {
  beforeEach(async () => void (await auth.requestCode(PHONE, IP)));
  const wrong = () => (sms.lastCode(PHONE) === "000000" ? "111111" : "000000");

  it("rejects wrong codes uniformly and destroys the code after 5 wrong guesses, even for the right code", async () => {
    const right = sms.lastCode(PHONE)!;
    for (let i = 0; i < 5; i++) expect(await fail(signIn({ code: wrong() }))).toMatchObject({ code: "invalid_code" });
    expect(await fail(signIn({ code: right }))).toMatchObject({ code: "invalid_code" });
    expect((await testDb.db.customerOtp.findFirstOrThrow()).invalidatedAt).not.toBeNull();
  });

  it("expires after 5 minutes", async () => {
    const code = sms.lastCode(PHONE)!;
    advance(min(5) + 1000);
    expect(await fail(signIn({ code }))).toMatchObject({ code: "invalid_code" });
  });

  it("is bound to the phone number and to the server secret", async () => {
    const code = sms.lastCode(PHONE)!;
    expect(await fail(signIn({ phone: OTHER, code }))).toMatchObject({ code: "invalid_code" });
    key = randomBytes(32); // a different server secret cannot validate existing hashes
    build();
    expect(await fail(signIn({ code }))).toMatchObject({ code: "invalid_code" });
  });

  it("can be consumed exactly once, even when submitted concurrently", async () => {
    const code = sms.lastCode(PHONE)!;
    const challenge = await otp.check(PHONE, code);
    const results = await Promise.all(Array.from({ length: 6 }, () => otp.consume(challenge.challengeId)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await fail(signIn({ code }))).toMatchObject({ code: "invalid_code" });
  });

  it("throttles code guessing per client address", async () => {
    for (let i = 0; i < 30; i++) await fail(signIn({ code: wrong() }));
    expect(await fail(signIn({ code: sms.lastCode(PHONE)! }))).toMatchObject({ code: "rate_limited" });
  });
});

describe("signing in", () => {
  it("registers a new customer after terms acceptance, without consuming the code when terms are missing", async () => {
    await auth.requestCode(PHONE, IP);
    const code = sms.lastCode(PHONE)!;
    expect(await fail(signIn({ acceptTerms: false }))).toMatchObject({ code: "terms_required" });
    expect(await testDb.db.customer.count()).toBe(0);
    const result = await signIn({ code });
    expect(result).toMatchObject({ isNewCustomer: true, pendingDeletion: false, customer: { phone: PHONE, status: "active", termsVersion: "2026-01" } });
    expect(result.customer.phoneVerifiedAt).toEqual(now);
    expect(await fail(signIn({ code }))).toMatchObject({ code: "invalid_code" }); // consumed: no replay
  });

  it("signs an existing customer in without asking for terms again", async () => {
    await auth.requestCode(PHONE, IP);
    await signIn();
    advance(min(20));
    await auth.requestCode(PHONE, IP);
    const second = await signIn({ acceptTerms: false });
    expect(second.isNewCustomer).toBe(false);
    expect(await testDb.db.customer.count()).toBe(1);
    expect((await store.findByPhone(PHONE))?.lastLoginAt).toEqual(now);
  });

  it("creates a session whose token is stored only as a hash and works through the cookie", async () => {
    await auth.requestCode(PHONE, IP);
    const r = await signIn();
    const row = await testDb.db.customerSession.findFirstOrThrow();
    expect(row.tokenHash).toBe(sha256Hex(r.token));
    expect(JSON.stringify(row)).not.toContain(r.token);
    expect(r.expiresAt.getTime() - now.getTime()).toBe(30 * 24 * 3600_000);
    expect(await authenticator.authenticate(requestWith(r.token))).toMatchObject({ customerId: r.customer.id, phone: PHONE, csrfToken: r.csrfToken, status: "active" });
  });

  it("refuses suspended customers and customers whose data was anonymised", async () => {
    await auth.requestCode(PHONE, IP);
    await signIn();
    await testDb.db.customer.update({ where: { phone: PHONE }, data: { status: "suspended" } });
    advance(min(20));
    await auth.requestCode(PHONE, IP);
    expect(await fail(signIn())).toMatchObject({ code: "account_suspended" });
  });

  it("lets a customer in the deletion grace period sign in and flags it", async () => {
    await auth.requestCode(PHONE, IP);
    await signIn();
    await testDb.db.customer.update({ where: { phone: PHONE }, data: { status: "pending_deletion", deletionRequestedAt: now, deletionScheduledAt: new Date(now.getTime() + 14 * 86400_000) } });
    advance(min(20));
    await auth.requestCode(PHONE, IP);
    expect((await signIn()).pendingDeletion).toBe(true);
  });

  it("survives a registration race: another request registered the same number a moment earlier", async () => {
    // The first lookup reports "not found" (as it would while the other request is still in flight); the
    // INSERT then hits the unique constraint and the service must recover by loading the existing customer.
    class RacyStore extends PrismaCustomerStore {
      lookups = 0;
      override async findByPhone(phone: string) {
        return this.lookups++ === 0 ? null : super.findByPhone(phone);
      }
    }
    const racy = new RacyStore(testDb.db);
    const racyOtp = new OtpService(racy, sms, key, DEFAULT_OTP_POLICY, () => now);
    const racyAuth = new CustomerAuthService(racy, racyOtp, new RateLimiter(() => now.getTime()), DEFAULT_CUSTOMER_AUTH, () => now);
    await racy.createCustomer({ phone: PHONE, termsVersion: "2026-01", now });
    await racyAuth.requestCode(PHONE, IP);
    const result = await racyAuth.signIn({ phone: PHONE, code: sms.lastCode(PHONE)!, acceptTerms: true, ip: IP, userAgent: null });
    expect(result.isNewCustomer).toBe(false);
    expect(await testDb.db.customer.count()).toBe(1);
    expect(await testDb.db.customerSession.count()).toBe(1);
  });
});

describe("sessions", () => {
  const login = async () => {
    await auth.requestCode(PHONE, IP);
    return signIn();
  };

  it("expire after 14 idle days and after 30 days in total", async () => {
    const idle = await login();
    advance(15 * 86400_000);
    expect(await authenticator.authenticate(requestWith(idle.token))).toBeNull();
    expect(await testDb.db.customerSession.count()).toBe(0);

    const long = await login();
    for (let i = 0; i < 4; i++) {
      advance(9 * 86400_000);
      await authenticator.authenticate(requestWith(long.token));
    }
    expect(await authenticator.authenticate(requestWith(long.token))).toBeNull(); // 36 days since sign-in
  });

  it("stop working after sign-out, suspension and for forged cookies", async () => {
    const a = await login();
    const principal = (await authenticator.authenticate(requestWith(a.token)))!;
    await auth.signOut(principal);
    expect(await authenticator.authenticate(requestWith(a.token))).toBeNull();

    advance(min(20));
    const b = await login();
    await testDb.db.customer.update({ where: { phone: PHONE }, data: { status: "suspended" } });
    expect(await authenticator.authenticate(requestWith(b.token))).toBeNull();
    for (const token of ["forged", "", "x".repeat(400)]) expect(await authenticator.authenticate(requestWith(token))).toBeNull();
    expect(await authenticator.authenticate(new Request("https://x.test/"))).toBeNull();
  });

  it("are purged together with old codes by the housekeeping job", async () => {
    await login();
    advance(31 * 86400_000);
    expect(await auth.purge()).toEqual({ sessions: 1, otps: 1 });
  });
});

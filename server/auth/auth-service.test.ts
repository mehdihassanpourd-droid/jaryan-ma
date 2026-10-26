import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { AuthFailure, AuthService, DEFAULT_AUTH_SETTINGS, type AuthSettings } from "./auth-service";
import { MemoryAdminStore } from "./memory-store";
import { ScryptHasher, type PasswordHasher } from "./password";
import { RateLimiter } from "./rate-limit";
import { SecretBox } from "./secret-box";
import { SessionAuthenticator, parseCookies, safeEqual, sessionCookie, clearedSessionCookie, sha256Hex } from "./session";
import { generateTotpSecret, totpAt, totpStep } from "./totp";

const PASSWORD = "rain-over-the-woven-hills-92";
const EMAIL = "owner@example.test";

let now: Date;
let store: MemoryAdminStore;
let hasher: CountingHasher;
let service: AuthService;
let authenticator: SessionAuthenticator;
let secret: string;
let accountId: string;

class CountingHasher implements PasswordHasher {
  verifies = 0;
  constructor(private inner = new ScryptHasher({ logN: 10, r: 8, p: 1 })) {}
  hash = (p: string) => this.inner.hash(p);
  verify = (p: string, s: string) => (this.verifies++, this.inner.verify(p, s));
  needsRehash = (s: string) => this.inner.needsRehash(s);
}

const codeNow = () => totpAt(secret, totpStep(now.getTime()));
const advance = (ms: number) => (now = new Date(now.getTime() + ms));
const loginInput = (over: Partial<Parameters<AuthService["login"]>[0]> = {}) => ({ email: EMAIL, password: PASSWORD, totp: codeNow(), ip: "10.0.0.1", userAgent: "vitest", ...over });
const failure = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as AuthFailure | null);

function build(settings: Partial<AuthSettings> = {}) {
  const box = new SecretBox(randomBytes(32));
  const merged = { ...DEFAULT_AUTH_SETTINGS, ...settings };
  service = new AuthService(store, hasher, box, new RateLimiter(() => now.getTime()), merged, () => now);
  authenticator = new SessionAuthenticator(store, { name: "sid", secure: true }, { idleMs: 2 * 3600_000, absoluteMs: merged.sessionAbsoluteMs }, () => now);
  return box;
}

async function makeAccount(withTotp = true) {
  secret = generateTotpSecret();
  const account = await service.createAccount({ email: EMAIL, password: PASSWORD, role: "owner", totpSecret: withTotp ? secret : null });
  accountId = account.id;
  return account;
}

const requestWith = (token: string) => new Request("https://admin.example.test/api/v1/me", { headers: { cookie: `sid=${token}` } });

beforeEach(async () => {
  now = new Date("2026-03-01T10:00:00.000Z");
  store = new MemoryAdminStore();
  hasher = new CountingHasher();
  build();
  await makeAccount();
});

describe("login", () => {
  it("signs in with password + TOTP and creates a session usable via the cookie", async () => {
    const result = await service.login(loginInput());
    expect(result.account).toEqual({ email: EMAIL, role: "owner" });
    expect(result.expiresAt.getTime() - now.getTime()).toBe(12 * 3600_000);
    const principal = await authenticator.authenticate(requestWith(result.token));
    expect(principal).toMatchObject({ email: EMAIL, role: "owner", csrfToken: result.csrfToken });
    expect(store.auditLog.map((a) => a.action)).toContain("login.success");
  });

  it("stores only a hash of the session token and an encrypted TOTP seed", async () => {
    const result = await service.login(loginInput());
    const stored = [...store.sessions.values()][0]!;
    expect(stored.tokenHash).toBe(sha256Hex(result.token));
    expect(JSON.stringify([...store.sessions.values()])).not.toContain(result.token);
    const acct = await store.findById(accountId);
    expect(acct?.totpSecretEnc).not.toContain(secret);
    expect(acct?.passwordHash).not.toContain(PASSWORD);
  });

  it("gives the same answer for a wrong password and an unknown email, and burns the same hashing work", async () => {
    const wrong = await failure(service.login(loginInput({ password: "wrong-password-123" })));
    const before = hasher.verifies;
    const unknown = await failure(service.login(loginInput({ email: "ghost@example.test" })));
    expect(wrong?.code).toBe("invalid_credentials");
    expect(unknown?.code).toBe("invalid_credentials");
    expect(hasher.verifies).toBe(before + 1); // a dummy verification ran
    expect((await failure(service.login(loginInput({ email: "not an email" }))))?.code).toBe("invalid_credentials");
  });

  it("requires a TOTP code and rejects wrong ones", async () => {
    expect((await failure(service.login(loginInput({ totp: undefined }))))?.code).toBe("totp_required");
    expect((await failure(service.login(loginInput({ totp: "000000" }))))?.code).toBe("invalid_totp");
    expect((await failure(service.login(loginInput({ totp: "abc" }))))?.code).toBe("invalid_totp");
  });

  it("never accepts the same TOTP code twice, but accepts the next one", async () => {
    const code = codeNow();
    await service.login(loginInput({ totp: code }));
    expect((await failure(service.login(loginInput({ totp: code }))))?.code).toBe("invalid_totp");
    advance(30_000);
    await service.login(loginInput({ totp: codeNow() }));
  });

  it("locks the account after repeated failures and unlocks it after the lock time", async () => {
    for (let i = 0; i < 5; i++) expect((await failure(service.login(loginInput({ password: "wrong-password-123", ip: `10.0.0.${i}` }))))?.code).toBe("invalid_credentials");
    const locked = await failure(service.login(loginInput({ ip: "10.9.9.9" })));
    expect(locked?.code).toBe("too_many_attempts");
    expect(locked?.retryAfterSeconds).toBe(900);
    expect(store.auditLog.map((a) => a.action)).toContain("admin.locked");
    advance(15 * 60_000 + 1000);
    await service.login(loginInput({ ip: "10.9.9.9" }));
    expect((await store.findById(accountId))?.failedLogins).toBe(0);
  });

  it("counts wrong TOTP codes toward the lock (6-digit codes cannot be brute-forced)", async () => {
    for (let i = 0; i < 5; i++) await failure(service.login(loginInput({ totp: "000000", ip: `10.1.0.${i}` })));
    expect((await failure(service.login(loginInput({ ip: "10.9.9.9" }))))?.code).toBe("too_many_attempts");
  });

  it("rate-limits by IP and by email before doing any password work", async () => {
    for (let i = 0; i < 10; i++) await failure(service.login(loginInput({ email: `u${i}@example.test`, ip: "10.5.5.5" })));
    const before = hasher.verifies;
    for (let i = 10; i < 30; i++) await failure(service.login(loginInput({ email: `u${i}@example.test`, ip: "10.5.5.5" })));
    const blocked = await failure(service.login(loginInput({ email: "u99@example.test", ip: "10.5.5.5" })));
    expect(blocked).toMatchObject({ code: "too_many_attempts" });
    expect(blocked?.retryAfterSeconds).toBeGreaterThan(0);
    expect(hasher.verifies - before).toBeLessThan(21);
  });

  it("rejects disabled accounts without revealing it", async () => {
    await store.setDisabled(accountId, true);
    expect((await failure(service.login(loginInput())))?.code).toBe("invalid_credentials");
  });

  it("refuses accounts without TOTP while it is mandatory, and allows them when it is not", async () => {
    store = new MemoryAdminStore();
    build();
    await makeAccount(false).catch((e: unknown) => expect((e as AuthFailure).code).toBe("totp_not_enrolled"));
    build({ requireTotp: false });
    await makeAccount(false);
    expect((await service.login(loginInput({ totp: undefined }))).account.email).toBe(EMAIL);
  });

  it("upgrades an old, weaker password hash at login", async () => {
    const weak = await new ScryptHasher({ logN: 8, r: 8, p: 1 }).hash(PASSWORD);
    await store.setPassword(accountId, weak, now);
    await service.login(loginInput());
    expect((await store.findById(accountId))?.passwordHash).toMatch(/^scrypt\$10\$/);
  });
});

describe("sessions", () => {
  it("expire after the idle timeout and the absolute lifetime", async () => {
    const idle = await service.login(loginInput());
    advance(2 * 3600_000 + 1000);
    expect(await authenticator.authenticate(requestWith(idle.token))).toBeNull();
    expect(store.sessions.size).toBe(0);

    advance(1000);
    const long = await service.login(loginInput({ totp: codeNow() }));
    for (let i = 0; i < 6; i++) {
      advance(110 * 60_000); // stay active, under the idle limit
      await authenticator.authenticate(requestWith(long.token));
    }
    advance(60 * 60_000);
    expect(await authenticator.authenticate(requestWith(long.token))).toBeNull();
  });

  it("are rejected after logout, when the account is disabled, and for unknown or oversized tokens", async () => {
    advance(0);
    const a = await service.login(loginInput());
    const principal = (await authenticator.authenticate(requestWith(a.token)))!;
    await service.logout(principal);
    expect(await authenticator.authenticate(requestWith(a.token))).toBeNull();

    advance(30_000);
    const b = await service.login(loginInput({ totp: codeNow() }));
    await store.setDisabled(accountId, true);
    expect(await authenticator.authenticate(requestWith(b.token))).toBeNull();
    expect(await authenticator.authenticate(requestWith("unknown-token"))).toBeNull();
    expect(await authenticator.authenticate(requestWith("x".repeat(500)))).toBeNull();
    expect(await authenticator.authenticate(new Request("https://x.test/"))).toBeNull();
  });
});

describe("password changes", () => {
  it("requires the current password, enforces the policy and signs out other sessions", async () => {
    const first = await service.login(loginInput());
    advance(30_000);
    const second = await service.login(loginInput({ totp: codeNow() }));
    const principal = (await authenticator.authenticate(requestWith(second.token)))!;

    expect((await failure(service.changePassword(principal, "wrong-current-pass", "a-brand-new-long-password")))?.code).toBe("invalid_credentials");
    expect((await failure(service.changePassword(principal, PASSWORD, "short")))).toMatchObject({ code: "weak_password", issues: ["too_short", "low_variety"] });

    await service.changePassword(principal, PASSWORD, "a-brand-new-long-password");
    expect(await authenticator.authenticate(requestWith(first.token))).toBeNull();
    expect(await authenticator.authenticate(requestWith(second.token))).not.toBeNull();
    advance(30_000);
    expect((await failure(service.login(loginInput({ totp: codeNow() }))))?.code).toBe("invalid_credentials");
    advance(30_000);
    await service.login(loginInput({ password: "a-brand-new-long-password", totp: codeNow() }));
  });
});

describe("account creation", () => {
  it("applies the password policy, rejects duplicates and bad emails, and normalises the email", async () => {
    store = new MemoryAdminStore();
    build();
    const s = generateTotpSecret();
    expect((await failure(service.createAccount({ email: "A@Example.test", password: "short", role: "editor", totpSecret: s })))?.code).toBe("weak_password");
    await expect(service.createAccount({ email: "nope", password: PASSWORD, role: "editor", totpSecret: s })).rejects.toThrow("invalid_email");
    const created = await service.createAccount({ email: "  Editor@Example.TEST ", password: PASSWORD, role: "editor", totpSecret: s });
    expect(created.email).toBe("editor@example.test");
    await expect(service.createAccount({ email: "editor@example.test", password: PASSWORD, role: "editor", totpSecret: s })).rejects.toThrow("account_exists");
    expect(service.provisioningUri(created.email, s)).toContain("otpauth://totp/Jaryan%20Ma");
  });
});

describe("administrator maintenance (CLI)", () => {
  it("resets a password, clears the lock and signs the person out everywhere", async () => {
    const session = await service.login(loginInput());
    await store.lock(accountId, new Date(now.getTime() + 3600_000));
    expect((await failure(service.resetPassword(EMAIL, "short")))?.code).toBe("weak_password");
    await service.resetPassword(EMAIL.toUpperCase(), "a-fresh-recovery-password-7");
    expect(await authenticator.authenticate(requestWith(session.token))).toBeNull();
    advance(30_000);
    expect((await service.login(loginInput({ password: "a-fresh-recovery-password-7", totp: codeNow() }))).account.email).toBe(EMAIL);
    await expect(service.resetPassword("ghost@example.test", "a-fresh-recovery-password-7")).rejects.toThrow("account_not_found");
  });

  it("replaces a lost authenticator and disables/enables accounts", async () => {
    const session = await service.login(loginInput());
    const fresh = generateTotpSecret();
    await service.resetTotp(EMAIL, fresh);
    expect(await authenticator.authenticate(requestWith(session.token))).toBeNull();
    advance(30_000);
    expect((await failure(service.login(loginInput({ totp: codeNow() }))))?.code).toBe("invalid_totp"); // old seed no longer works
    secret = fresh;
    advance(30_000);
    await service.login(loginInput({ totp: codeNow() }));

    await service.setDisabled(EMAIL, true);
    expect(await service.listAccounts()).toEqual([{ email: EMAIL, role: "owner", disabled: true, totpEnrolled: true, locked: false }]);
    expect(JSON.stringify(await service.listAccounts())).not.toContain("scrypt");
    await service.setDisabled(EMAIL, false);
    expect((await service.listAccounts())[0]?.disabled).toBe(false);
    expect(store.auditLog.map((a) => a.action)).toEqual(expect.arrayContaining(["totp.reset", "admin.disabled", "admin.enabled"]));
  });
});

describe("cookie helpers", () => {
  it("builds a hardened session cookie and parses cookie headers", () => {
    const c = sessionCookie({ name: "__Host-sid", secure: true }, "tok", 3600);
    expect(c).toBe("__Host-sid=tok; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600; Secure");
    expect(sessionCookie({ name: "sid", secure: false }, "tok", 1)).not.toContain("Secure");
    expect(clearedSessionCookie({ name: "sid", secure: true })).toContain("Max-Age=0");
    expect(parseCookies("a=1; sid=abc%20d; junk").get("sid")).toBe("abc d");
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

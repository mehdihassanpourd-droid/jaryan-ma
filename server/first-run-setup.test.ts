import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./db/test-database";
import { loadConfig, ConfigError } from "./config";
import { totpAt, totpStep } from "./auth/totp";
import { buildTestApp, call, PASSWORD, type TestApp } from "./testing/app";

let testDb: TestDatabase;
let app: TestApp;

beforeAll(async () => void (testDb = await createTestDatabase()), 60_000);
afterAll(async () => testDb.close());
beforeEach(async () => {
  app = await buildTestApp(testDb, { firstRunSetup: true });
});

const status = () => call(app, { path: "/api/v1/setup/status" });
const begin = (body: Record<string, unknown>, over: Partial<Parameters<typeof call>[1]> = {}) => call(app, { method: "POST", path: "/api/v1/setup/begin", body, ...over });
const finish = (body: Record<string, unknown>, over: Partial<Parameters<typeof call>[1]> = {}) => call(app, { method: "POST", path: "/api/v1/setup/finish", body, ...over });
const code = (secret: string, offset = 0) => totpAt(secret, totpStep(app.now().getTime()) + offset);

describe("first-run setup (development only)", () => {
  it("is open only while there are no administrators", async () => {
    expect((await status()).body).toEqual({ open: true });
    await app.auth.createAccount({ email: "someone@example.test", password: PASSWORD, role: "owner", totpSecret: "JBSWY3DPEHPK3PXP" });
    expect((await status()).body).toEqual({ open: false });
    expect((await begin({ email: "late@example.test", password: PASSWORD })).status).toBe(403);
  });

  it("creates a real owner with mandatory TOTP, who then signs in only with password + code", async () => {
    const started = await begin({ email: "Owner@Example.test", password: PASSWORD });
    expect(started.status).toBe(200);
    expect(started.res.headers.get("cache-control")).toBe("no-store");
    expect(started.body.otpauthUri).toContain("otpauth://totp/");
    expect(started.body.otpauthUri).toContain(started.body.secret);

    const done = await finish({ token: started.body.token, code: code(started.body.secret) });
    expect(done.status).toBe(201);
    expect(done.body).toEqual({ email: "owner@example.test" });
    expect((await status()).body).toEqual({ open: false });

    // the stored account demands TOTP like any other: password alone is refused
    const login = (totp?: string) => call(app, { method: "POST", path: "/api/v1/auth/login", body: { email: "owner@example.test", password: PASSWORD, ...(totp ? { totp } : {}) } });
    expect((await login()).status).toBe(401);
    app.advance(30_000);
    const ok = await login(code(started.body.secret));
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe("owner");
    expect(ok.body.permissions).toContain("product:publish");
  });

  it("stores nothing until the TOTP code is proven, and refuses wrong codes", async () => {
    const started = await begin({ email: "owner@example.test", password: PASSWORD });
    const wrong = await finish({ token: started.body.token, code: "000000" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe("invalid_totp");
    expect(await app.auth.listAccounts()).toHaveLength(0);
    expect((await finish({ token: "not-a-real-token", code: code(started.body.secret) })).status).toBe(410);
  });

  it("discards a pending setup after 5 wrong codes", async () => {
    const started = await begin({ email: "owner@example.test", password: PASSWORD });
    for (let i = 0; i < 5; i++) await finish({ token: started.body.token, code: "000000" });
    const late = await finish({ token: started.body.token, code: code(started.body.secret) });
    expect(late.status).toBe(410);
    expect(await app.auth.listAccounts()).toHaveLength(0);
  });

  it("expires after 10 minutes", async () => {
    const started = await begin({ email: "owner@example.test", password: PASSWORD });
    app.advance(11 * 60_000);
    expect((await finish({ token: started.body.token, code: code(started.body.secret) })).status).toBe(410);
  });

  it("applies the same password and email rules as the command-line tool", async () => {
    const weak = await begin({ email: "owner@example.test", password: "short" });
    expect(weak.status).toBe(422);
    expect(weak.body.error).toBe("weak_password");
    expect(weak.body.issues).toContain("too_short");
    expect((await begin({ email: "owner@example.test", password: "owner-owner-owner" })).body.issues).toContain("contains_email");
    expect((await begin({ email: "not-an-email", password: PASSWORD })).body.error).toBe("invalid_email");
  });

  it("a token works once and cannot create a second account", async () => {
    const started = await begin({ email: "owner@example.test", password: PASSWORD });
    const c = code(started.body.secret);
    expect((await finish({ token: started.body.token, code: c })).status).toBe(201);
    expect((await finish({ token: started.body.token, code: c })).status).toBe(403); // closed now
    expect(await app.auth.listAccounts()).toHaveLength(1);
  });

  it("is cross-site safe (Origin enforced) and rate limited", async () => {
    expect((await begin({ email: "owner@example.test", password: PASSWORD }, { origin: "https://evil.example" })).status).toBe(403);
    let last = 0;
    for (let i = 0; i < 20; i++) last = (await begin({ email: "owner@example.test", password: PASSWORD })).status;
    expect(last).toBe(429);
  });

  it("tells a development sign-in page which commit runs, and says nothing in production", async () => {
    const dev = await buildTestApp(testDb, { firstRunSetup: true, originDebug: true, build: "abc1234" });
    expect((await call(dev, { path: "/api/v1/setup/status" })).body).toEqual({ open: true, build: "abc1234" });
    const prod = await buildTestApp(testDb, { firstRunSetup: true, build: "abc1234" }); // originDebug (development) off
    expect((await call(prod, { path: "/api/v1/setup/status" })).body).toEqual({ open: true });
    expect(loadConfig({ APP_COMMIT: "abc1234" }).appCommit).toBe("abc1234");
    expect(() => loadConfig({ APP_COMMIT: "not a sha; rm -rf" })).toThrow(ConfigError);
    expect(loadConfig({}).appCommit).toBeNull();
  });

  it("does not exist unless configured, and the configuration refuses it in production", async () => {
    const plain = await buildTestApp(testDb);
    expect((await call(plain, { path: "/api/v1/setup/status" })).body).toEqual({ open: false });
    expect((await call(plain, { method: "POST", path: "/api/v1/setup/begin", body: { email: "a@b.cc", password: PASSWORD } })).status).toBe(404);

    expect(loadConfig({ FIRST_RUN_SETUP: "true" }).firstRunSetup).toBe(true);
    expect(loadConfig({}).firstRunSetup).toBe(false);
    const prod = { NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@127.0.0.1/db", PUBLIC_MEDIA_URL: "https://m.example.ir", APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), ADMIN_ORIGINS: "https://a.example.ir", STORAGE_DRIVER: "s3", S3_ENDPOINT: "https://s3.example.ir", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" };
    expect(() => loadConfig(prod)).not.toThrow();
    expect(() => loadConfig({ ...prod, FIRST_RUN_SETUP: "true" })).toThrow(ConfigError);
  });
});

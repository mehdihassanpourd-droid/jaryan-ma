/* GitHub Codespaces (and any TLS-terminating forwarder) in DEVELOPMENT: the browser's Origin is the external https host it
 * addressed. These tests pin down exactly what is, and is not, accepted. */
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";
import { createTestDatabase, type TestDatabase } from "./db/test-database";
import { originAllowed } from "./http";
import { createNodeHandler } from "./node-adapter";
import { totpAt, totpStep } from "./auth/totp";
import { buildTestApp, call, PASSWORD, type TestApp } from "./testing/app";

const SUFFIX = [".app.github.dev"];
const HOST = "glowing-garbanzo-ab12cd-3001.app.github.dev";
const reqFor = (headers: Record<string, string>, url = `https://${HOST}/api/v1/setup/begin`) => new Request(url, { method: "POST", headers });

describe("originAllowed", () => {
  it("still accepts the exact allow-listed origin and refuses everything else when no suffix rule is configured", () => {
    expect(originAllowed(reqFor({ origin: `https://${HOST}` }), `https://${HOST}`)).toBe(true);
    expect(originAllowed(reqFor({ origin: `https://${HOST}/` }), `https://${HOST}`)).toBe(true);
    expect(originAllowed(reqFor({ origin: `https://${HOST}` }), "https://other.example")).toBe(false);
    expect(originAllowed(reqFor({}), `https://${HOST}`)).toBe(false); // no Origin header
    expect(originAllowed(reqFor({ origin: `https://${HOST}` }), undefined)).toBe(false); // empty allow-list fails closed
    expect(originAllowed(reqFor({ origin: `https://${HOST}` }), "")).toBe(false);
  });

  it("accepts the same-origin forwarded host even when the allow-list string differs (the Codespaces failure)", () => {
    const wrongList = "https://some-other-name-3001.app.github.dev";
    expect(originAllowed(reqFor({ origin: `https://${HOST}`, host: HOST }, `http://127.0.0.1:3001/x`), wrongList)).toBe(false); // without the rule: refused
    expect(originAllowed(reqFor({ origin: `https://${HOST}`, host: HOST }, `http://127.0.0.1:3001/x`), wrongList, { sameHostSuffixes: SUFFIX })).toBe(true);
    expect(originAllowed(reqFor({ origin: `https://${HOST}`, host: HOST }, `http://127.0.0.1:3001/x`), undefined, { sameHostSuffixes: SUFFIX })).toBe(true);
  });

  it("also recognises the forwarded host in X-Forwarded-Host and in the request URL", () => {
    expect(originAllowed(reqFor({ origin: `https://${HOST}`, "x-forwarded-host": HOST }, "http://127.0.0.1:3001/x"), undefined, { sameHostSuffixes: SUFFIX })).toBe(true);
    expect(originAllowed(reqFor({ origin: `https://${HOST}`, "x-forwarded-host": `${HOST}, proxy.internal` }, "http://127.0.0.1:3001/x"), undefined, { sameHostSuffixes: SUFFIX })).toBe(true);
    expect(originAllowed(reqFor({ origin: `https://${HOST}` }, `http://${HOST}/x`), undefined, { sameHostSuffixes: SUFFIX })).toBe(true);
  });

  it("refuses a cross-site page: its Origin is not the host being called", () => {
    for (const origin of ["https://evil.example", "https://evil-3000.app.github.dev", `https://${HOST.replace("ab12cd", "zz99zz")}`]) {
      expect(originAllowed(reqFor({ origin, host: HOST }), undefined, { sameHostSuffixes: SUFFIX }), origin).toBe(false);
    }
    // another Codespace calling this one: suffix matches but it is not the host the request was addressed to
    expect(originAllowed(reqFor({ origin: "https://attacker-3001.app.github.dev", host: HOST }), undefined, { sameHostSuffixes: SUFFIX })).toBe(false);
  });

  it("is not a wildcard: wrong suffix, scheme, port, credentials, path, bare suffix and look-alikes are refused", () => {
    const cases: Array<[string, string]> = [
      [`https://${HOST}.evil.example`, `${HOST}.evil.example`], // suffix only as a label prefix
      ["https://x.app.github.dev.evil.example", "x.app.github.dev.evil.example"],
      [`http://${HOST}`, HOST], // not https
      [`https://${HOST}:8443`, `${HOST}:8443`], // explicit port
      [`https://user:pw@${HOST}`, HOST], // credentials
      [`https://${HOST}/path`, HOST], // not a bare origin
      ["https://app.github.dev", "app.github.dev"], // the bare suffix itself
      ["https://.app.github.dev", ".app.github.dev"],
      ["null", HOST],
      [`https://${HOST.toUpperCase()}`.replace("HTTPS", "https"), HOST], // same host, different case is fine (see next test)
    ];
    for (const [origin, host] of cases.slice(0, -1)) expect(originAllowed(reqFor({ origin, host }), undefined, { sameHostSuffixes: SUFFIX }), origin).toBe(false);
    expect(originAllowed(reqFor({ origin: `https://${HOST.toUpperCase()}`, host: HOST }), undefined, { sameHostSuffixes: SUFFIX })).toBe(true);
  });

  it("only the configured suffixes count", () => {
    expect(originAllowed(reqFor({ origin: "https://a-1.example.dev", host: "a-1.example.dev" }), undefined, { sameHostSuffixes: SUFFIX })).toBe(false);
    expect(originAllowed(reqFor({ origin: "https://a-1.example.dev", host: "a-1.example.dev" }), undefined, { sameHostSuffixes: [".example.dev"] })).toBe(true);
  });
});

describe("GitHub's forwarder REWRITES Origin and Host to the upstream address (the real Codespaces failure)", () => {
  // What the server actually receives for a browser that is on https://<codespace>-3001.app.github.dev:
  const EXTERNAL = "https://poisonous-spooky-gravestone-ab12cd-3001.app.github.dev";
  // Like the real Node adapter, the request URL is built from the Host header.
  const seen = (headers: Record<string, string> = {}) => {
    const merged = { origin: "http://localhost:3001", host: "localhost:3001", ...headers };
    return reqFor(merged, `http://${merged.host}/api/v1/setup/begin`);
  };

  it("is refused by the exact allow-list and by the same-host rule alone (this is the bug)", () => {
    expect(originAllowed(seen(), EXTERNAL)).toBe(false);
    expect(originAllowed(seen(), EXTERNAL, { sameHostSuffixes: SUFFIX })).toBe(false);
  });

  it("is accepted when the rewritten loopback origin of THIS server's own port is expected (development, Codespaces)", () => {
    expect(originAllowed(seen(), EXTERNAL, { sameHostSuffixes: SUFFIX, rewrittenOriginPort: 3001 })).toBe(true);
    expect(originAllowed(reqFor({ origin: "http://127.0.0.1:3001", host: "127.0.0.1:3001" }), EXTERNAL, { rewrittenOriginPort: 3001 })).toBe(true);
  });

  it("is off unless asked for (production never asks)", () => {
    expect(originAllowed(seen(), EXTERNAL, { rewrittenOriginPort: undefined })).toBe(false);
    expect(originAllowed(seen(), EXTERNAL)).toBe(false);
  });

  it("is not a localhost wildcard: other ports, other hosts, https, credentials and a Host that disagrees are refused", () => {
    const opts = { rewrittenOriginPort: 3001 };
    expect(originAllowed(seen({ origin: "http://localhost:8080" }), EXTERNAL, opts)).toBe(false); // another local app
    expect(originAllowed(seen({ origin: "http://localhost" }), EXTERNAL, opts)).toBe(false); // default port
    expect(originAllowed(seen({ origin: "https://localhost:3001" }), EXTERNAL, opts)).toBe(false);
    expect(originAllowed(seen({ origin: "http://user:pw@localhost:3001" }), EXTERNAL, opts)).toBe(false);
    expect(originAllowed(seen({ origin: "http://localhost:3001/x" }), EXTERNAL, opts)).toBe(false);
    expect(originAllowed(seen({ origin: "http://evil.example:3001", host: "evil.example:3001" }), EXTERNAL, opts)).toBe(false); // DNS rebinding shape
    expect(originAllowed(seen({ host: "localhost:3002" }), EXTERNAL, opts)).toBe(false); // Host is not this server
    expect(originAllowed(seen({ host: "evil.example" }), EXTERNAL, opts)).toBe(false);
    expect(originAllowed(seen({ origin: "null" }), EXTERNAL, opts)).toBe(false);
    expect(originAllowed(reqFor({ host: "localhost:3001" }), EXTERNAL, opts)).toBe(false); // no Origin at all
  });

  it("keeps a cross-site guard where the browser still tells us: a foreign Referer vetoes the rewritten origin", () => {
    const opts = { rewrittenOriginPort: 3001 };
    expect(originAllowed(seen({ referer: `${EXTERNAL}/admin/` }), EXTERNAL, opts)).toBe(true); // our own page
    expect(originAllowed(seen({ referer: "http://localhost:3001/admin/" }), EXTERNAL, opts)).toBe(true);
    expect(originAllowed(seen({ referer: "https://evil.example/pay" }), EXTERNAL, opts)).toBe(false);
    expect(originAllowed(seen({ referer: "https://attacker-3001.app.github.dev/" }), EXTERNAL, { ...opts, sameHostSuffixes: SUFFIX })).toBe(false); // another Codespace
    expect(originAllowed(seen({ referer: "not a url" }), EXTERNAL, opts)).toBe(false);
  });
});

describe("configuration of the forwarded-host rule", () => {
  const prod = { NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@127.0.0.1/db", PUBLIC_MEDIA_URL: "https://m.example.ir", APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), ADMIN_ORIGINS: "https://a.example.ir", STORAGE_DRIVER: "s3", S3_ENDPOINT: "https://s3.example.ir", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" };

  it("is empty by default and parses a list in development", () => {
    expect(loadConfig({}).adminOriginHostSuffixes).toEqual([]);
    expect(loadConfig({ ADMIN_ORIGIN_HOST_SUFFIXES: ".app.github.dev, .Example.DEV" }).adminOriginHostSuffixes).toEqual([".app.github.dev", ".example.dev"]);
  });

  it("rejects anything that could be a wildcard (no leading dot, bare TLD, scheme, path, star)", () => {
    for (const bad of ["app.github.dev", ".dev", ".", "*.app.github.dev", "https://.app.github.dev", ".app.github.dev/x", ".app github.dev"]) {
      expect(() => loadConfig({ ADMIN_ORIGIN_HOST_SUFFIXES: bad }), bad).toThrow(ConfigError);
    }
  });

  it("the rewritten-origin switch is off by default, development-only, and refused in production", () => {
    expect(loadConfig({}).adminAcceptRewrittenOrigin).toBe(false);
    expect(loadConfig({ ADMIN_ACCEPT_REWRITTEN_ORIGIN: "true" }).adminAcceptRewrittenOrigin).toBe(true);
    expect(() => loadConfig({ ...prod, ADMIN_ACCEPT_REWRITTEN_ORIGIN: "true" })).toThrow(/development-only/);
    expect(loadConfig({ ...prod, ADMIN_ACCEPT_REWRITTEN_ORIGIN: "false" }).adminAcceptRewrittenOrigin).toBe(false);
  });

  it("is REFUSED in production, so production keeps the exact allow-list only", () => {
    expect(() => loadConfig(prod)).not.toThrow();
    expect(loadConfig(prod).adminOriginHostSuffixes).toEqual([]);
    expect(() => loadConfig({ ...prod, ADMIN_ORIGIN_HOST_SUFFIXES: ".app.github.dev" })).toThrow(/development-only/);
  });
});

let testDb: TestDatabase;
let app: TestApp;
beforeAll(async () => void (testDb = await createTestDatabase()), 60_000);
afterAll(async () => testDb.close());

describe("through the API", () => {
  beforeEach(async () => {
    app = await buildTestApp(testDb, { firstRunSetup: true, adminOrigins: "https://wrong-name-3001.app.github.dev", originHostSuffixes: SUFFIX, originDebug: true });
  });
  const begin = (headers: Record<string, string>, host = HOST) => call(app, { method: "POST", path: "/api/v1/setup/begin", host, origin: null, headers, body: { email: "owner@example.test", password: PASSWORD } });

  it("first-admin setup works from the forwarded origin although ADMIN_ORIGINS has a different name", async () => {
    expect((await begin({ origin: `https://${HOST}` })).status).toBe(200);
  });

  it("CSRF protection is intact: foreign origins and other Codespaces get 403", async () => {
    for (const origin of ["https://evil.example", "https://attacker-3001.app.github.dev", "null"]) {
      const r = await begin({ origin });
      expect(r.status, origin).toBe(403);
      expect(r.body.error).toBe("bad_origin");
    }
    expect((await begin({})).status).toBe(403); // no Origin header at all
  });

  it("a refused origin is explained in development (what was received, what was requested)", async () => {
    const r = await begin({ origin: "https://evil.example" });
    expect(r.body.detail).toMatchObject({ receivedOrigin: "https://evil.example", requestedHost: expect.arrayContaining([HOST]), allowedOrigins: "https://wrong-name-3001.app.github.dev" });
    expect(app.logs.some((l) => l.event === "bad_origin")).toBe(true);
  });

  it("without the rule configured (production), the same request is refused and says nothing about why", async () => {
    const strict = await buildTestApp(testDb, { firstRunSetup: true, adminOrigins: "https://admin.example.ir" });
    const r = await call(strict, { method: "POST", path: "/api/v1/setup/begin", host: HOST, origin: null, headers: { origin: `https://${HOST}` }, body: { email: "owner@example.test", password: PASSWORD } });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({ error: "bad_origin" });
  });

  it("the CSRF token is still required for signed-in changes, whatever the origin rule says", async () => {
    const withRule = await buildTestApp(testDb, { originHostSuffixes: SUFFIX }); // default allow-list, so the helper can sign in
    const owner = await withRule.session("owner");
    const r = await call(withRule, { method: "POST", path: "/api/v1/products", host: HOST, as: owner, csrf: null, origin: null, headers: { origin: `https://${HOST}` }, body: { name: "x" } });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("bad_csrf_token");
  });
});

describe("over real HTTP, as GitHub's forwarder presents it (external Host + Origin, TLS terminated upstream)", () => {
  let server: Server;
  let port: number;
  beforeEach(async () => {
    app = await buildTestApp(testDb, { firstRunSetup: true, adminOrigins: "https://wrong-name-3001.app.github.dev", originHostSuffixes: SUFFIX, originDebug: true });
    server = createServer(createNodeHandler((r) => app.handle(r), { trustProxy: false, maxBodyBytes: 1_000_000 }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => void (await new Promise<void>((resolve) => server.close(() => resolve()))));

  const send = (path: string, body: unknown, headers: Record<string, string>) =>
    new Promise<{ status: number; json: any }>((resolve, reject) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const text = JSON.stringify(body);
      const r = httpRequest({ host: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), ...headers } }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : null }));
      });
      r.on("error", reject);
      r.end(text);
    });

  it("completes the whole first-admin setup with TOTP through the forwarded HTTPS host", async () => {
    const forwarded = { host: HOST, origin: `https://${HOST}`, "x-forwarded-proto": "https" };
    const begun = await send("/api/v1/setup/begin", { email: "owner@example.test", password: PASSWORD }, forwarded);
    expect(begun.status).toBe(200);
    expect(begun.json.otpauthUri).toContain("otpauth://totp/");

    const wrong = await send("/api/v1/setup/finish", { token: begun.json.token, code: "000000" }, forwarded);
    expect(wrong.status).toBe(401); // TOTP is verified, not skipped

    const done = await send("/api/v1/setup/finish", { token: begun.json.token, code: totpAt(begun.json.secret, totpStep(app.now().getTime())) }, forwarded);
    expect(done.status).toBe(201);
    expect(await app.auth.listAccounts()).toHaveLength(1);

    // and a real sign-in through the same forwarded host needs password + a code
    app.advance(30_000);
    const noCode = await send("/api/v1/auth/login", { email: "owner@example.test", password: PASSWORD }, forwarded);
    expect(noCode.status).toBe(401);
    const login = await send("/api/v1/auth/login", { email: "owner@example.test", password: PASSWORD, totp: totpAt(begun.json.secret, totpStep(app.now().getTime())) }, forwarded);
    expect(login.status).toBe(200);
  });

  it("the same flow from another site (foreign Origin, or another Codespace's origin) is refused", async () => {
    for (const origin of ["https://evil.example", "https://attacker-3001.app.github.dev"]) {
      const r = await send("/api/v1/setup/begin", { email: "owner@example.test", password: PASSWORD }, { host: HOST, origin });
      expect(r.status, origin).toBe(403);
    }
    expect(await app.auth.listAccounts()).toHaveLength(0);
  });
});

describe("the exact Codespaces mismatch, through the API and over real HTTP", () => {
  const EXTERNAL = "https://poisonous-spooky-gravestone-ab12cd-3001.app.github.dev";
  const body = { email: "owner@example.test", password: PASSWORD };

  it("reproduces the bug: external ADMIN_ORIGINS + rewritten http://localhost:3001 is refused (and explained) without the fix", async () => {
    const before = await buildTestApp(testDb, { firstRunSetup: true, adminOrigins: EXTERNAL, originHostSuffixes: SUFFIX, originDebug: true });
    const r = await call(before, { method: "POST", path: "/api/v1/setup/begin", host: "localhost:3001", origin: null, headers: { origin: "http://localhost:3001", referer: `${EXTERNAL}/admin/` }, body });
    expect(r.status).toBe(403);
    expect(r.body.detail).toMatchObject({ receivedOrigin: "http://localhost:3001", requestedHost: expect.arrayContaining(["localhost:3001"]), allowedOrigins: EXTERNAL, referer: EXTERNAL });
  });

  it("is accepted once the rewritten loopback origin is expected, and a hostile page is still refused", async () => {
    const fixed = await buildTestApp(testDb, { firstRunSetup: true, adminOrigins: EXTERNAL, originHostSuffixes: SUFFIX, rewrittenOriginPort: 3001, originDebug: true });
    const via = (headers: Record<string, string>, host = "localhost:3001") => call(fixed, { method: "POST", path: "/api/v1/setup/begin", host, origin: null, headers, body });
    expect((await via({ origin: "http://localhost:3001", referer: `${EXTERNAL}/admin/` })).status).toBe(200); // what the forwarder delivers
    expect((await via({ origin: "http://localhost:3001" })).status).toBe(200); // no Referer sent
    expect((await via({ origin: "http://localhost:3001", referer: "https://evil.example/" })).status).toBe(403); // cross-site page, even though Origin was rewritten
    expect((await via({ origin: "http://localhost:8080" })).status).toBe(403);
    expect((await via({ origin: "http://localhost:3001" }, "evil.example")).status).toBe(403);
    expect((await via({})).status).toBe(403);
  });

  it("signed-in changes still need the CSRF token even with the rewritten origin accepted", async () => {
    const fixed = await buildTestApp(testDb, { rewrittenOriginPort: 3001 }); // default allow-list so the helper can sign in
    const owner = await fixed.session("owner");
    const r = await call(fixed, { method: "POST", path: "/api/v1/products", host: "localhost:3001", as: owner, csrf: null, origin: null, headers: { origin: "http://localhost:3001" }, body: { name: "x" } });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("bad_csrf_token");
  });

  describe("over real HTTP (a forwarder that rewrites Origin and Host to the upstream address)", () => {
    let server: Server;
    let port: number;
    beforeEach(async () => {
      // The server picks its port at runtime; the allow-list is the external https origin, exactly like the Codespaces scripts.
      server = createServer((req, res) => handler!(req, res));
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      port = (server.address() as AddressInfo).port;
      app = await buildTestApp(testDb, { firstRunSetup: true, adminOrigins: EXTERNAL, originHostSuffixes: SUFFIX, rewrittenOriginPort: port, originDebug: true });
      handler = createNodeHandler((r) => app.handle(r), { trustProxy: false, maxBodyBytes: 1_000_000 });
    });
    let handler: ReturnType<typeof createNodeHandler> | undefined;
    afterEach(async () => void (await new Promise<void>((resolve) => server.close(() => resolve()))));

    const send = (path: string, payload: unknown, headers: Record<string, string>) =>
      new Promise<{ status: number; json: any }>((resolve, reject) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const text = JSON.stringify(payload);
        const r = httpRequest({ host: "127.0.0.1", port, path, method: "POST", headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), ...headers } }, (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : null }));
        });
        r.on("error", reject);
        r.end(text);
      });

    it("first-admin setup with TOTP and the first sign-in work with Origin/Host rewritten to localhost", async () => {
      const rewritten = { host: `localhost:${port}`, origin: `http://localhost:${port}`, referer: `${EXTERNAL}/admin/` };
      const begun = await send("/api/v1/setup/begin", body, rewritten);
      expect(begun.status).toBe(200);
      expect((await send("/api/v1/setup/finish", { token: begun.json.token, code: "000000" }, rewritten)).status).toBe(401); // TOTP is verified
      const done = await send("/api/v1/setup/finish", { token: begun.json.token, code: totpAt(begun.json.secret, totpStep(app.now().getTime())) }, rewritten);
      expect(done.status).toBe(201);
      app.advance(30_000);
      expect((await send("/api/v1/auth/login", body, rewritten)).status).toBe(401); // password alone is refused
      const login = await send("/api/v1/auth/login", { ...body, totp: totpAt(begun.json.secret, totpStep(app.now().getTime())) }, rewritten);
      expect(login.status).toBe(200);
      expect(login.json.role).toBe("owner");
    });

    it("a hostile page is refused over real HTTP too, and nothing is created", async () => {
      const hostile: Array<Record<string, string>> = [
        { host: `localhost:${port}`, origin: `http://localhost:${port}`, referer: "https://evil.example/" },
        { host: `localhost:${port}`, origin: "http://localhost:9" },
        { host: "evil.example", origin: `http://localhost:${port}` },
      ];
      for (const headers of hostile) {
        expect((await send("/api/v1/setup/begin", body, headers)).status, JSON.stringify(headers)).toBe(403);
      }
      expect(await app.auth.listAccounts()).toHaveLength(0);
    });
  });
});

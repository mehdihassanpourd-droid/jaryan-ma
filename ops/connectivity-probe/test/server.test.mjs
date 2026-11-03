import assert from "node:assert/strict";
import { connect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { HOSTS, haveNginx, haveOpenssl, httpGet, httpsCall, startProbe } from "./helpers.mjs";

const skip = !haveNginx || !haveOpenssl ? "nginx or openssl is not installed" : false;

describe("probe server (real nginx, HTTPS)", { skip }, () => {
  let probe;
  const page = (path, options) => httpsCall(probe.httpsPort, HOSTS.page, path, options);
  const api = (path, options) => httpsCall(probe.httpsPort, HOSTS.api, path, options);
  const pay = (path, options) => httpsCall(probe.httpsPort, HOSTS.pay, path, options);
  const origin = () => `https://${HOSTS.page}:${probe.httpsPort}`;

  before(async () => {
    probe = await startProbe();
  });
  after(async () => probe?.stop());

  describe("storefront host", () => {
    it("serves the test page with strict headers and no server version", async () => {
      const r = await page("/");
      assert.equal(r.status, 200);
      assert.match(r.body, /آزمون اتصال/);
      assert.match(r.headers["content-security-policy"], /default-src 'none'/);
      assert.match(r.headers["content-security-policy"], new RegExp(`connect-src 'self' https://${HOSTS.api}:${probe.httpsPort}`));
      assert.equal(r.headers["x-content-type-options"], "nosniff");
      assert.equal(r.headers["x-frame-options"], "DENY");
      assert.match(r.headers["strict-transport-security"], /max-age=\d+/);
      assert.ok(!/nginx\/\d/.test(String(r.headers.server ?? "")), "server version must not be disclosed");
    });

    it("serves the product image (valid PNG, ~300 KB) and the catalogue (~100 KB JSON)", async () => {
      const img = await new Promise((resolve, reject) => {
        import("node:https").then(({ request }) => {
          const req = request({ host: "127.0.0.1", port: probe.httpsPort, path: "/img/product.png", servername: HOSTS.page, rejectUnauthorized: false, headers: { host: HOSTS.page } }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], body: Buffer.concat(chunks) }));
          });
          req.on("error", reject);
          req.end();
        });
      });
      assert.equal(img.status, 200);
      assert.equal(img.type, "image/png");
      assert.deepEqual([...img.body.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      assert.ok(img.body.length > 250_000 && img.body.length < 400_000, `image size ${img.body.length}`);
      const cat = await page("/data/catalog.json");
      assert.equal(cat.status, 200);
      assert.ok(cat.body.length > 80_000 && cat.body.length < 130_000);
      assert.equal(JSON.parse(cat.body).products.length, 400);
    });

    it("reports only the address FAMILY, never the address", async () => {
      const r = await page("/probe/ip");
      assert.deepEqual(JSON.parse(r.body), { family: "ipv4" });
      assert.ok(!r.body.includes("127.0.0.1"));
    });

    it("refuses other methods and hides dot files and traversal", async () => {
      assert.equal((await page("/", { method: "POST", body: "x" })).status, 405);
      assert.equal((await page("/", { method: "DELETE" })).status, 405);
      assert.equal((await page("/.env")).status, 404);
      assert.equal((await page("/.git/config")).status, 404);
      assert.ok([400, 404].includes((await page("/../../etc/passwd")).status));
      assert.equal((await page("/nope")).status, 404);
    });

    it("the payment redirect is a fixed round trip (no open redirect)", async () => {
      const start = await page("/pay/start?next=https://evil.example/&url=//evil.example");
      assert.equal(start.status, 302);
      assert.equal(start.headers.location, `https://${HOSTS.pay}:${probe.httpsPort}/gateway`);
      const gateway = await pay("/gateway?back=https://evil.example");
      assert.equal(gateway.status, 302);
      assert.equal(gateway.headers.location, `${origin()}/?pay=returned`);
      assert.equal((await pay("/anything")).status, 404);
      assert.equal((await pay("/gateway", { method: "POST", body: "x" })).status, 405);
    });
  });

  describe("API host: CORS", () => {
    it("allows exactly one origin, with credentials, and never reflects an arbitrary Origin or uses *", async () => {
      const r = await api("/api/ping", { headers: { origin: "https://evil.example" } });
      assert.equal(r.status, 200);
      assert.equal(r.headers["access-control-allow-origin"], origin());
      assert.equal(r.headers["access-control-allow-credentials"], "true");
      assert.match(r.headers.vary, /Origin/);
      const ok = await api("/api/ping", { headers: { origin: origin() } });
      assert.equal(ok.headers["access-control-allow-origin"], origin());
      assert.deepEqual(Object.keys(JSON.parse(ok.body)).sort(), ["ok", "t"]);
    });

    it("answers a preflight for POST with a JSON content type", async () => {
      const r = await api("/api/order", { method: "OPTIONS", headers: { origin: origin(), "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
      assert.equal(r.status, 204);
      assert.equal(r.headers["access-control-allow-origin"], origin());
      assert.equal(r.headers["access-control-allow-credentials"], "true");
      assert.match(r.headers["access-control-allow-methods"], /POST/);
      assert.match(r.headers["access-control-allow-headers"], /Content-Type/i);
    });

    it("serves the catalogue from a file, GET/HEAD only", async () => {
      const r = await api("/api/catalog");
      assert.equal(r.status, 200);
      assert.equal(JSON.parse(r.body).products.length, 400);
      assert.equal((await api("/api/catalog", { method: "POST", body: "{}" })).status, 405);
      assert.equal((await api("/api/unknown")).status, 404);
      assert.equal((await api("/")).status, 404);
    });
  });

  describe("API host: cookie session round trip", () => {
    it("login sets a Secure, HttpOnly, SameSite=Lax cookie and /me reads the same id back", async () => {
      const login = await api("/api/login", { method: "POST", headers: { origin: origin() } });
      assert.equal(login.status, 200);
      const sid = JSON.parse(login.body).sid;
      assert.match(sid, /^[0-9a-f]{32}$/);
      const cookie = [login.headers["set-cookie"]].flat().find((c) => c.startsWith("jm_probe_sid="));
      assert.ok(cookie, "Set-Cookie present");
      assert.ok(cookie.startsWith(`jm_probe_sid=${sid};`));
      for (const attr of ["Secure", "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=900"]) assert.ok(cookie.includes(attr), `cookie has ${attr}`);
      assert.equal(login.headers["access-control-allow-origin"], origin());
      const me = await api("/api/me", { headers: { cookie: `jm_probe_sid=${sid}` } });
      assert.equal(JSON.parse(me.body).sid, sid);
      assert.equal(JSON.parse((await api("/api/me")).body).sid, null);
    });

    it("never echoes a cookie value that does not have the shape login issues (no reflection)", async () => {
      for (const bad of ['jm_probe_sid="}{"x":1', "jm_probe_sid=<script>", "jm_probe_sid=ABCDEF", `jm_probe_sid=${"a".repeat(64)}`]) {
        const me = await api("/api/me", { headers: { cookie: bad } });
        assert.equal(me.status, 200);
        assert.equal(JSON.parse(me.body).sid, null, bad);
      }
    });

    it("login needs POST", async () => {
      assert.equal((await api("/api/login")).status, 405);
    });
  });

  describe("API host: simulated cart and order", () => {
    it("accepts a cart and echoes only the byte count; GET is refused", async () => {
      const body = JSON.stringify({ items: [{ id: "x", quantity: 2 }] });
      const r = await api("/api/cart", { method: "POST", headers: { "content-type": "application/json" }, body });
      assert.equal(r.status, 200);
      assert.deepEqual(JSON.parse(r.body), { ok: true, simulated: true, received: Buffer.byteLength(body) });
      assert.equal((await api("/api/cart")).status, 405);
    });

    it("accepts a 600 KB order, answers with a fake PROBE- number, and rejects bodies over 1 MB", async () => {
      const body = JSON.stringify({ note: "x".repeat(600 * 1024) });
      const r = await api("/api/order", { method: "POST", headers: { "content-type": "application/json" }, body });
      assert.equal(r.status, 200);
      const json = JSON.parse(r.body);
      assert.equal(json.simulated, true);
      assert.equal(json.received, Buffer.byteLength(body));
      assert.match(json.orderNumber, /^PROBE-[0-9a-f]{32}$/);
      const tooBig = await api("/api/order", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(2 * 1024 * 1024) }).catch((e) => ({ status: `error:${e.code}` }));
      assert.ok(tooBig.status === 413 || String(tooBig.status).startsWith("error:"), `oversized body refused (${tooBig.status})`);
    });

    it("a POST without a body is still valid JSON", async () => {
      const r = await api("/api/cart", { method: "POST" });
      assert.equal(JSON.parse(r.body).received, 0);
    });
  });

  describe("result collection", () => {
    const sample = Buffer.from(JSON.stringify({ schema: 1, tool: "jm-connectivity-probe", verdict: "pass" })).toString("base64url");

    it("logs a valid base64url result to the report log only", async () => {
      const r = await api(`/api/report?r=${sample}`, { headers: { origin: origin() } });
      assert.equal(r.status, 204);
      assert.ok(probe.reportLog().includes(sample));
      assert.ok(!probe.accessLog().includes(sample), "the result is not copied into the access log");
    });

    it("rejects anything that is not base64url (no log injection), too short or too long values, and other methods", async () => {
      const before = probe.reportLog();
      for (const bad of ["a%0Ab%0Dc", "short", "x".repeat(7100), "%22%3E%3Cb%3E" + "a".repeat(30), "a b c d e f g h i j k l m n o p"]) {
        const r = await api(`/api/report?r=${bad}`).catch((e) => ({ status: `error:${e.code}` }));
        assert.ok([400, 414].includes(r.status) || String(r.status).startsWith("error:"), `${bad.slice(0, 20)} -> ${r.status}`);
      }
      assert.equal((await api(`/api/report?r=${sample}`, { method: "POST", body: "x" })).status, 405);
      assert.equal((await api("/api/report")).status, 400);
      assert.equal(probe.reportLog(), before, "nothing invalid reached the report log");
    });
  });

  describe("it is not an open proxy and does not answer unknown hosts", () => {
    it("closes the connection for an unknown Host over HTTP, including a request by IP address", async () => {
      for (const host of ["evil.example", "127.0.0.1", `probe.${"x"}.example`]) {
        const r = await httpGet(probe.httpPort, "/", { host }).catch((e) => ({ status: `closed:${e.code}` }));
        assert.ok(String(r.status).startsWith("closed:"), `${host} -> ${r.status}`);
      }
    });

    it("refuses the TLS handshake for an unknown server name", async () => {
      await assert.rejects(httpsCall(probe.httpsPort, "evil.example", "/"));
    });

    it("does not forward an absolute-URI (proxy-style) request", async () => {
      const reply = await new Promise((resolve) => {
        const socket = connect(probe.httpPort, "127.0.0.1", () => socket.write("GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n"));
        let data = "";
        socket.on("data", (d) => (data += d));
        socket.on("close", () => resolve(data));
        socket.on("error", () => resolve(data));
        setTimeout(() => socket.destroy(), 3000);
      });
      assert.ok(!/HTTP\/1\.1 200/.test(reply), `no proxy answer, got: ${reply.slice(0, 60)}`);
    });

    it("refuses CONNECT", async () => {
      const reply = await new Promise((resolve) => {
        const socket = tlsConnect({ host: "127.0.0.1", port: probe.httpsPort, servername: HOSTS.page, rejectUnauthorized: false }, () => socket.write(`CONNECT example.com:443 HTTP/1.1\r\nHost: ${HOSTS.page}\r\nConnection: close\r\n\r\n`));
        let data = "";
        socket.on("data", (d) => (data += d));
        socket.on("close", () => resolve(data));
        socket.on("error", () => resolve(data));
        setTimeout(() => socket.destroy(), 3000);
      });
      assert.ok(!/HTTP\/1\.1 200/.test(reply), `no tunnel, got: ${reply.slice(0, 60)}`);
    });
  });

  describe("HTTP side", () => {
    it("redirects to HTTPS on the right port", async () => {
      const r = await httpGet(probe.httpPort, "/some/path?x=1", { host: HOSTS.page });
      assert.equal(r.status, 301);
      assert.equal(r.headers.location, `https://${HOSTS.page}:${probe.httpsPort}/some/path?x=1`);
    });

    it("serves ACME HTTP-01 challenge files (for Let's Encrypt) and nothing else from that folder", async () => {
      mkdirSync(join(probe.dir, "acme/.well-known/acme-challenge"), { recursive: true, mode: 0o777 });
      writeFileSync(join(probe.dir, "acme/.well-known/acme-challenge/tok"), "token-123", { mode: 0o666 });
      const r = await httpGet(probe.httpPort, "/.well-known/acme-challenge/tok", { host: HOSTS.page });
      assert.equal(r.status, 200);
      assert.equal(r.body, "token-123");
      assert.equal((await httpGet(probe.httpPort, "/.well-known/other", { host: HOSTS.page })).status, 301);
    });
  });

  describe("HTTPS configuration", () => {
    it("works with TLS 1.2 and TLS 1.3", async () => {
      const v12 = await httpsCall(probe.httpsPort, HOSTS.page, "/probe/ip", { minVersion: "TLSv1.2", maxVersion: "TLSv1.2" });
      assert.equal(v12.status, 200);
      const v13 = await httpsCall(probe.httpsPort, HOSTS.page, "/probe/ip", { minVersion: "TLSv1.3", maxVersion: "TLSv1.3" });
      assert.equal(v13.status, 200);
    });
  });

  describe("limits", () => {
    it("rate-limits one client (429) without affecting another, and recovers", async () => {
      const burst = await Promise.all(Array.from({ length: 150 }, () => api("/api/ping", { localAddress: "127.0.0.55" }).catch(() => ({ status: 0 }))));
      const codes = burst.map((r) => r.status);
      assert.ok(codes.includes(200), "some requests pass");
      assert.ok(codes.includes(429), "the flood is limited");
      assert.equal((await api("/api/ping", { localAddress: "127.0.0.56" })).status, 200, "another client is unaffected");
      await new Promise((resolve) => setTimeout(resolve, 4000));
      assert.equal((await api("/api/ping", { localAddress: "127.0.0.55" })).status, 200, "recovers");
    });

    it("limits the result collection to about one per second per client", async () => {
      const sample = Buffer.from(JSON.stringify({ n: Math.random() })).toString("base64url").padEnd(24, "A");
      const codes = await Promise.all(Array.from({ length: 30 }, () => api(`/api/report?r=${sample}`, { localAddress: "127.0.0.57" }).then((r) => r.status)));
      assert.ok(codes.includes(204));
      assert.ok(codes.includes(429));
    });
  });

  describe("privacy", () => {
    it("the access log holds a masked client address and no query, cookie, user agent or referer", async () => {
      await api("/api/ping?token=SECRETQUERY123", { localAddress: "127.0.0.77", headers: { "user-agent": "SECRET-UA-AGENT-XYZ", cookie: "jm_probe_sid=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", referer: "https://referer.example/SECRETREF" } });
      await page("/probe/ip", { localAddress: "127.0.0.78" });
      const log = probe.accessLog();
      assert.ok(log.includes(" 127.0.0.0 "), "masked address a.b.c.0 is logged");
      for (const forbidden of ["127.0.0.77", "127.0.0.78", "SECRETQUERY123", "SECRET-UA-AGENT-XYZ", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "SECRETREF"]) assert.ok(!log.includes(forbidden), `access log must not contain ${forbidden}`);
      assert.match(log, /\/api\/ping/);
    });

    it("the nginx error log (set to level crit, as the instructions say) holds no raw client address either", async () => {
      await api("/api/order", { method: "POST", localAddress: "127.0.0.79", body: "x".repeat(2 * 1024 * 1024) }).catch(() => undefined);
      await page("/nope", { localAddress: "127.0.0.79" });
      assert.ok(!probe.errorLog().includes("127.0.0.79"));
    });

    it("the report log contains only a timestamp and the page's own result (no address)", async () => {
      const sample = Buffer.from(JSON.stringify({ privacy: "check" })).toString("base64url").padEnd(24, "A");
      await api(`/api/report?r=${sample}`, { localAddress: "127.0.0.88" });
      const line = probe.reportLog().split("\n").find((l) => l.includes(sample));
      assert.ok(line);
      assert.match(line, /^\d{4}-\d\d-\d\dT[\d:+.-]+ [A-Za-z0-9_-]+$/);
      assert.ok(!probe.reportLog().includes("127.0.0.88"));
    });
  });
});

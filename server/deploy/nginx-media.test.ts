import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runs a REAL nginx with the configuration the installer renders (deploy/configure-nginx.sh) in front of two fake upstreams
 * on loopback: an S3-compatible object store that contains public AND private objects and a MinIO-style admin API, and the
 * application. It proves what the public internet can and cannot reach. Skipped where nginx is not installed.
 */
const nginx = spawnSync("nginx", ["-v"]);
const haveNginx = nginx.status === 0 || String(nginx.stderr).includes("nginx/");
const ROOT = join(import.meta.dirname, "..", "..");

interface Seen { url: string; headers: IncomingMessage["headers"]; method: string }

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

function get(port: number, host: string, path: string, options: { method?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; body: string; headers: IncomingMessage["headers"] }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: options.method ?? "GET", headers: { host, ...options.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe.skipIf(!haveNginx)("nginx in front of the app and the object store (real nginx)", () => {
  let dir: string;
  let proc: ChildProcess;
  let s3: Server;
  let api: Server;
  let port: number;
  const s3Seen: Seen[] = [];
  const apiSeen: Seen[] = [];
  const SHOP = "shop.jaryan.test", API = "api.jaryan.test", ADMIN = "admin.jaryan.test", MEDIA = "media.jaryan.test";

  async function startNginx(extra: string[] = []) {
    const s3Port = (s3.address() as AddressInfo).port;
    const apiPort = (api.address() as AddressInfo).port;
    const free = createServer();
    port = await listen(free);
    await new Promise((r) => free.close(r));
    mkdirSync(join(dir, "conf.d"), { recursive: true });
    const r = spawnSync("bash", [join(ROOT, "deploy/configure-nginx.sh"), "--shop", SHOP, "--api", API, "--admin", ADMIN, "--media", MEDIA, "--out", join(dir, "conf.d"), "--no-tls", "--listen-port", String(port),
      "--api-upstream", `127.0.0.1:${apiPort}`, "--s3-upstream", `127.0.0.1:${s3Port}`, "--bucket", "jaryan-media", "--web-root", join(dir, "www"), ...extra], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    writeFileSync(join(dir, "nginx.conf"), `worker_processes 1;\npid ${dir}/nginx.pid;\nerror_log ${dir}/error.log warn;\nevents { worker_connections 256; }\nhttp {\n  access_log off;\n  client_body_temp_path ${dir}/tmp/body; proxy_temp_path ${dir}/tmp/proxy; fastcgi_temp_path ${dir}/tmp/fcgi; uwsgi_temp_path ${dir}/tmp/uwsgi; scgi_temp_path ${dir}/tmp/scgi;\n  default_type application/octet-stream;\n  types { text/html html; text/plain txt; application/json json; image/webp webp; }\n  include ${dir}/conf.d/jaryan-common.conf;\n  include ${dir}/conf.d/jaryan-shop.conf;\n  include ${dir}/conf.d/jaryan-api.conf;\n  include ${dir}/conf.d/jaryan-admin.conf;\n  include ${dir}/conf.d/jaryan-media.conf;\n}\n`);
    const test = spawnSync("nginx", ["-t", "-p", dir, "-c", join(dir, "nginx.conf")], { encoding: "utf8" });
    expect(test.status, test.stderr).toBe(0);
    proc = spawn("nginx", ["-p", dir, "-c", join(dir, "nginx.conf"), "-g", "daemon off;"], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      try {
        await get(port, SHOP, "/");
        return;
      } catch {
        await new Promise((r2) => setTimeout(r2, 100));
      }
    }
    throw new Error(`nginx did not start: ${readFileSync(join(dir, "error.log"), "utf8")}`);
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "jm-nginx-"));
    chmodSync(dir, 0o755);
    for (const d of ["tmp", "tmp/body", "tmp/proxy", "tmp/fcgi", "tmp/uwsgi", "tmp/scgi", "www/v1"]) mkdirSync(join(dir, d), { recursive: true, mode: 0o777 });
    for (const d of ["tmp", "tmp/body", "tmp/proxy", "tmp/fcgi", "tmp/uwsgi", "tmp/scgi"]) chmodSync(join(dir, d), 0o777);
    writeFileSync(join(dir, "www/v1/index.html"), "<html>storefront</html>");
    writeFileSync(join(dir, "www/v1/404.html"), "<html>nf</html>");
    writeFileSync(join(dir, "www/v1/.env"), "SECRET=1");
    writeFileSync(join(dir, "www/v1/app.js.map"), "{}");
    mkdirSync(join(dir, "www/v1/_next/static"), { recursive: true });
    writeFileSync(join(dir, "www/v1/_next/static/a.js"), "x");
    chmodSync(dir, 0o755);
    spawnSync("chmod", ["-R", "a+rX", join(dir, "www")]);
    spawnSync("ln", ["-s", "v1", join(dir, "www/current")]);

    // fake S3-compatible server: a bucket with public objects, private objects, a listing and an admin API
    s3 = createServer((req, res) => {
      s3Seen.push({ url: req.url ?? "", headers: req.headers, method: req.method ?? "" });
      const u = req.url ?? "";
      const send = (status: number, body: string, headers: Record<string, string> = {}) => { res.writeHead(status, { server: "MinIO", "x-amz-request-id": "REQ1", "x-minio-deployment-id": "DEP1", ...headers }); res.end(body); };
      if (u === "/jaryan-media/images/a.webp") return send(200, "IMAGE-BYTES", { "content-type": "image/webp", "cache-control": "public, max-age=31536000, immutable" });
      if (u === "/jaryan-media/catalog/products.json") return send(200, '{"products":[]}', { "content-type": "application/json" });
      if (u.startsWith("/jaryan-media/private/")) return send(200, "PRIVATE-DATA");
      if (u.startsWith("/jaryan-media/backups/")) return send(200, "BACKUP-DATA");
      if (u.startsWith("/minio/")) return send(200, "MINIO-ADMIN");
      if (u.startsWith("/jaryan-media/?") || u === "/jaryan-media/" || u === "/jaryan-media") return send(200, "<ListBucketResult><Name>jaryan-media</Name></ListBucketResult>");
      return send(404, "<Error><Code>NoSuchKey</Code><BucketName>jaryan-media</BucketName><Resource>/jaryan-media/x</Resource></Error>", { "content-type": "application/xml" });
    });
    await listen(s3);
    api = createServer((req, res) => {
      apiSeen.push({ url: req.url ?? "", headers: req.headers, method: req.method ?? "" });
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
    await listen(api);
    await startNginx();
  }, 30_000);

  afterAll(async () => {
    proc?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    s3?.close();
    api?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  describe("media host", () => {
    it("serves public images and catalogue snapshots, read-only, with the shop as the only allowed CORS origin", async () => {
      const img = await get(port, MEDIA, "/images/a.webp");
      expect(img.status).toBe(200);
      expect(img.body).toBe("IMAGE-BYTES");
      expect(img.headers["cache-control"]).toContain("immutable");
      expect(img.headers["access-control-allow-origin"]).toBe(`http://${SHOP}`);
      expect(img.headers["x-content-type-options"]).toBe("nosniff");
      const cat = await get(port, MEDIA, "/catalog/products.json");
      expect(cat.status).toBe(200);
      expect(JSON.parse(cat.body)).toEqual({ products: [] });
      expect((await get(port, MEDIA, "/images/a.webp", { method: "HEAD" })).status).toBe(200);
    });

    it("never reaches private objects, the bucket root, listings, the S3 admin API or anything outside the two prefixes", async () => {
      const before = s3Seen.length;
      const denied = ["/", "/jaryan-media/", "/jaryan-media/private/x.txt", "/private/x.txt", "/backups/db.dump.enc", "/minio/admin/v3/info", "/minio/health/live", "/?list-type=2", "/images/", "/catalog/", "/images", "/catalog", "/index.html", "/images/%2e%2e/private/x.txt", "/images/../private/x.txt", "/images/..%2fprivate/x.txt", "/images/a.webp%00.png", "/images/a%20b.webp", "/images/a.webp/../../minio/admin/v3/info", "//minio/admin/v3/info", "/images//..//minio/x"];
      for (const path of denied) {
        const res = await get(port, MEDIA, path);
        expect([400, 404], `${path} -> ${res.status}`).toContain(res.status);
        expect(res.body, path).not.toMatch(/PRIVATE-DATA|BACKUP-DATA|MINIO-ADMIN|ListBucketResult/);
      }
      // none of those requests was even forwarded to the object store, except the well-formed-but-missing ones that it answered with 404
      const forwarded = s3Seen.slice(before).map((s) => s.url);
      for (const url of forwarded) expect(url, url).not.toMatch(/private|backups|minio|list-type/);
    });

    it("drops the query string and the client's credentials, and does not forward anything the client chose", async () => {
      const before = s3Seen.length;
      const res = await get(port, MEDIA, "/images/a.webp?acl&versionId=1&X-Amz-Signature=abc", { headers: { cookie: "session=SECRET", authorization: "AWS4-HMAC-SHA256 Credential=EVIL", "x-amz-acl": "public-read", "x-forwarded-for": "9.9.9.9" } });
      expect(res.status).toBe(200);
      const seen = s3Seen.slice(before)[0];
      expect(seen?.url).toBe("/jaryan-media/images/a.webp");
      expect(JSON.stringify(seen?.headers)).not.toMatch(/SECRET|EVIL|x-amz-acl|9\.9\.9\.9|cookie|authorization/i);
    });

    it("refuses every method except GET, HEAD and OPTIONS", async () => {
      for (const method of ["PUT", "POST", "DELETE", "PATCH"]) expect((await get(port, MEDIA, "/images/a.webp", { method })).status, method).toBe(405);
    });

    it("hides the object store: no Server/x-amz/x-minio headers and no XML error page that names the bucket", async () => {
      const ok = await get(port, MEDIA, "/images/a.webp");
      for (const h of ["server", "x-amz-request-id", "x-minio-deployment-id"]) expect(ok.headers[h] ?? "").not.toMatch(/minio|REQ1|DEP1/i);
      const missing = await get(port, MEDIA, "/images/does-not-exist.webp");
      expect(missing.status).toBe(404);
      expect(missing.body).not.toMatch(/jaryan-media|NoSuchKey|BucketName|xml/i);
    });
  });

  describe("API host and admin host", () => {
    it("the public API host forwards only customer/public endpoints and health; the admin API and PWA are not reachable on it", async () => {
      for (const path of ["/api/v1/customer/me", "/api/v1/public/faq", "/health"]) expect((await get(port, API, path)).status, path).toBe(200);
      for (const path of ["/api/v1/products", "/api/v1/auth/login", "/api/v1/maintenance/health", "/admin/", "/healthz", "/", "/api/v1"]) expect((await get(port, API, path)).status, path).toBe(404);
    });

    it("the admin host forwards the PWA and the admin API, never the customer or public endpoints", async () => {
      for (const path of ["/admin/", "/api/v1/products", "/api/v1/maintenance/health", "/healthz"]) expect((await get(port, ADMIN, path)).status, path).toBe(200);
      for (const path of ["/api/v1/customer/me", "/api/v1/public/faq", "/health", "/readyz"]) expect((await get(port, ADMIN, path)).status, path).toBe(404);
      const root = await get(port, ADMIN, "/");
      expect(root.status).toBe(302);
      expect(root.headers.location).toBe("/admin/");
    });

    it("overwrites X-Forwarded-For (a client cannot choose its own address) and gives the app a request id", async () => {
      const before = apiSeen.length;
      await get(port, API, "/api/v1/public/faq", { headers: { "x-forwarded-for": "1.2.3.4", "x-request-id": "client-chosen-id" } });
      const seen = apiSeen.slice(before)[0];
      expect(seen?.headers["x-forwarded-for"]).toBe("127.0.0.1");
      expect(seen?.headers["x-request-id"]).toMatch(/^[0-9a-f]{32}$/);
      expect(seen?.headers["x-request-id"]).not.toBe("client-chosen-id");
    });

    it("/readyz is reachable from the allowed monitoring address only", async () => {
      expect((await get(port, API, "/readyz")).status).toBe(200); // 127.0.0.1 is the default allow-list
      proc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      await startNginx(["--readyz-allow", "10.9.9.9"]);
      expect((await get(port, API, "/readyz")).status).toBe(403);
      expect((await get(port, API, "/health")).status).toBe(200);
    }, 30_000);
  });

  describe("static storefront host", () => {
    it("serves the export from the current release, with headers, and never dot files or source maps", async () => {
      const home = await get(port, SHOP, "/");
      expect(home.status).toBe(200);
      expect(home.body).toContain("storefront");
      expect(home.headers["content-security-policy"]).toContain("default-src 'self'");
      expect(home.headers["x-frame-options"]).toBe("DENY");
      expect((await get(port, SHOP, "/_next/static/a.js")).headers["cache-control"]).toContain("immutable");
      expect((await get(port, SHOP, "/.env")).status).toBe(404);
      expect((await get(port, SHOP, "/missing")).status).toBe(404);
      expect((await get(port, SHOP, "/", { method: "POST" })).status).toBe(405);
    });
  });

  describe("production TLS configuration", () => {
    const openssl = spawnSync("openssl", ["version"]).status === 0;
    it.skipIf(!openssl)("renders with TLS, redirects port 80 to https, and passes nginx -t", () => {
      const tlsDir = join(dir, "tls");
      const out = join(dir, "conf-tls");
      for (const domain of [SHOP, API, ADMIN, MEDIA]) {
        mkdirSync(join(tlsDir, domain), { recursive: true });
        const gen = spawnSync("openssl", ["req", "-x509", "-nodes", "-newkey", "rsa:2048", "-subj", `/CN=${domain}`, "-days", "1", "-keyout", join(tlsDir, domain, "privkey.pem"), "-out", join(tlsDir, domain, "fullchain.pem")], { encoding: "utf8" });
        expect(gen.status, gen.stderr).toBe(0);
      }
      const r = spawnSync("bash", [join(ROOT, "deploy/configure-nginx.sh"), "--shop", SHOP, "--api", API, "--admin", ADMIN, "--media", MEDIA, "--out", out, "--tls-dir", tlsDir, "--https-port", "18443", "--http-port", "18080", "--web-root", join(dir, "www")], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      const media = readFileSync(join(out, "jaryan-media.conf"), "utf8");
      expect(media).toContain("listen 18443 ssl");
      expect(readFileSync(join(out, "jaryan-security-headers.conf"), "utf8")).toContain("Strict-Transport-Security");
      expect(readFileSync(join(out, "jaryan-redirect.conf"), "utf8")).toContain("return 301 https://$host$request_uri");
      writeFileSync(join(dir, "nginx-tls.conf"), `worker_processes 1;\npid ${dir}/nginx-tls.pid;\nerror_log ${dir}/error-tls.log warn;\nevents { worker_connections 64; }\nhttp {\n  access_log off;\n  client_body_temp_path ${dir}/tmp/body; proxy_temp_path ${dir}/tmp/proxy; fastcgi_temp_path ${dir}/tmp/fcgi; uwsgi_temp_path ${dir}/tmp/uwsgi; scgi_temp_path ${dir}/tmp/scgi;\n  include ${out}/jaryan-common.conf;\n  include ${out}/jaryan-shop.conf;\n  include ${out}/jaryan-api.conf;\n  include ${out}/jaryan-admin.conf;\n  include ${out}/jaryan-media.conf;\n  include ${out}/jaryan-redirect.conf;\n}\n`);
      const test = spawnSync("nginx", ["-t", "-p", dir, "-c", join(dir, "nginx-tls.conf")], { encoding: "utf8" });
      expect(test.status, test.stderr).toBe(0);
    });

    it("refuses invalid domains and non-private upstreams", () => {
      const base = ["--shop", SHOP, "--api", API, "--admin", ADMIN, "--media", MEDIA, "--out", join(dir, "conf-bad"), "--no-tls"];
      expect(spawnSync("bash", [join(ROOT, "deploy/configure-nginx.sh"), ...base.slice(2).filter(() => false), "--shop", "bad domain; rm", "--api", API, "--admin", ADMIN, "--media", MEDIA, "--out", join(dir, "conf-bad"), "--no-tls"]).status).toBe(64);
      expect(spawnSync("bash", [join(ROOT, "deploy/configure-nginx.sh"), ...base, "--s3-upstream", "8.8.8.8:9000"]).status).toBe(64);
      expect(spawnSync("bash", [join(ROOT, "deploy/configure-nginx.sh"), ...base, "--bucket", "../etc"]).status).toBe(64);
    });
  });
});

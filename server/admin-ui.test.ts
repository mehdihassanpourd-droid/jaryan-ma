import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminContentSecurityPolicy, createAdminUiHandler, createUnbuiltAdminUiHandler } from "./admin-ui";

let dir: string;
let outside: string;
let handle: ReturnType<typeof createAdminUiHandler>;

beforeAll(async () => {
  outside = await mkdtemp(join(tmpdir(), "jm-admin-outside-"));
  dir = await mkdtemp(join(tmpdir(), "jm-admin-ui-"));
  await writeFile(join(outside, "secret.txt"), "TOP-SECRET");
  await writeFile(join(dir, "index.html"), "<!doctype html><title>admin</title>");
  await writeFile(join(dir, "sw.js"), "/* sw */");
  await writeFile(join(dir, "manifest.webmanifest"), "{}");
  await writeFile(join(dir, ".env"), "SECRET=1");
  await writeFile(join(dir, "notes.md"), "not served");
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, "assets", "app-abc123.js"), "console.log(1)");
  await symlink(join(outside, "secret.txt"), join(dir, "link.txt")).catch(() => undefined);
  handle = createAdminUiHandler({ dir, mediaOrigin: "https://media.example.ir" });
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const get = async (path: string, method = "GET") => (await handle(method, path))!;

describe("serving the admin app", () => {
  it("is not involved in other paths, and redirects /admin to /admin/", async () => {
    expect(await handle("GET", "/api/v1/products")).toBeNull();
    expect(await handle("GET", "/administrator")).toBeNull();
    expect(await get("/admin")).toMatchObject({ status: 308, headers: { location: "/admin/" } });
  });

  it("sends the bare server address to the admin app instead of a 404 (what a forwarded port opens)", async () => {
    expect(await get("/")).toMatchObject({ status: 302, headers: { location: "/admin/", "cache-control": "no-store" } });
    expect(await get("/", "HEAD")).toMatchObject({ status: 302 });
    expect(await handle("POST", "/")).toBeNull(); // only GET/HEAD are redirected; other methods fall through to the API
  });

  it("serves index.html at /admin/ and revalidates it, so new releases reach installed apps", async () => {
    const r = await get("/admin/");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(r.headers["cache-control"]).toBe("no-cache");
    expect(r.body?.toString()).toContain("<title>admin</title>");
  });

  it("caches hashed assets forever but never the service worker or manifest", async () => {
    expect((await get("/admin/assets/app-abc123.js")).headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    const sw = await get("/admin/sw.js");
    expect(sw.headers["cache-control"]).toBe("no-cache");
    expect(sw.headers["service-worker-allowed"]).toBe("/admin/");
    expect((await get("/admin/manifest.webmanifest")).headers["content-type"]).toBe("application/manifest+json; charset=utf-8");
  });

  it("supports HEAD without a body and refuses every other method", async () => {
    const head = await get("/admin/", "HEAD");
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) expect(await get("/admin/", method)).toMatchObject({ status: 405, headers: { allow: "GET, HEAD" } });
  });
});

describe("what it refuses to serve", () => {
  it("path traversal in every spelling", async () => {
    for (const path of ["/admin/../secret.txt", "/admin/%2e%2e/secret.txt", "/admin/..%2fsecret.txt", "/admin/assets/../../secret.txt", "/admin/%2e%2e%2f%2e%2e%2fetc/passwd", "/admin/..\\secret.txt", "/admin/%5c..%5csecret.txt", "/admin/a%00.js"]) {
      const r = await get(path);
      expect(r.status, path).toBe(404);
      expect(r.body?.toString() ?? "", path).not.toContain("TOP-SECRET");
    }
  });

  it("dot files, unknown file types, missing files and directories", async () => {
    for (const path of ["/admin/.env", "/admin/notes.md", "/admin/nope.js", "/admin/assets/", "/admin/assets", "/admin/%E0%A4%A.js"]) expect((await get(path)).status, path).toBe(404);
  });

  it("a symlink that points outside the directory", async () => {
    const r = await get("/admin/link.txt");
    // .txt is a served type, so the protection is the containment check on the REAL (symlink-resolved) path
    expect(r.status).toBe(404);
    expect(r.body?.toString() ?? "").not.toContain("TOP-SECRET");
  });
});

describe("response headers", () => {
  it("every response carries a strict CSP with no inline script or style allowed", async () => {
    for (const path of ["/admin/", "/admin/sw.js", "/admin/nope"]) {
      const csp = (await get(path)).headers["content-security-policy"]!;
      expect(csp, path).toContain("default-src 'none'");
      expect(csp, path).toContain("script-src 'self'");
      expect(csp, path).toContain("frame-ancestors 'none'");
      expect(csp, path).not.toContain("unsafe-inline");
      expect(csp, path).not.toContain("unsafe-eval");
    }
  });

  it("allows images only from itself, blob: previews, data: and the media bucket", () => {
    expect(adminContentSecurityPolicy("https://media.example.ir")).toContain("img-src 'self' blob: data: https://media.example.ir;");
    expect(adminContentSecurityPolicy(null)).toContain("img-src 'self' blob: data:;");
    expect(adminContentSecurityPolicy()).toContain("connect-src 'self'");
  });

  it("is not framable, not sniffable, and sends no referrer", async () => {
    const h = (await get("/admin/")).headers;
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["cross-origin-resource-policy"]).toBe("same-origin");
  });
});

describe("when the admin app has not been built", () => {
  const unbuilt = createUnbuiltAdminUiHandler();

  it("explains what is missing (503) instead of an unexplained 404, for /, /admin and /admin/*", async () => {
    for (const path of ["/", "/admin", "/admin/", "/admin/assets/app.js"]) {
      const r = (await unbuilt("GET", path))!;
      expect(r.status, path).toBe(503);
      expect(r.body?.toString()).toContain("npm run admin:build");
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
    }
  });

  it("leaves API and media paths alone and serves no files", async () => {
    expect(await unbuilt("GET", "/api/v1/products")).toBeNull();
    expect(await unbuilt("GET", "/media/images/a/b.png")).toBeNull();
    expect((await unbuilt("HEAD", "/admin/"))!.body).toBeNull();
  });
});

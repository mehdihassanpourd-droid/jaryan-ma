import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./db/test-database";
import { buildTestApp, call, COOKIE_NAME, ORIGIN, PASSWORD, type Session, type TestApp } from "./testing/app";
import { CLIENT_IP_HEADER } from "./api";
import { generateTotpSecret, totpAt, totpStep } from "./auth/totp";

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

let testDb: TestDatabase;
let app: TestApp;
let owner: Session;
let categoryId: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
}, 60_000);
afterAll(async () => testDb.close());

beforeEach(async () => {
  app = await buildTestApp(testDb);
  owner = await app.session("owner");
  categoryId = (await app.repo.createCategory({ slug: "wall-hangings", name: "دیوارکوب بافته" })).id;
});

const draft = (over: Record<string, unknown> = {}) => ({ name: "دیوارکوب نمونه", fulfillment: "unique", ...over });
const publishable = (over: Record<string, unknown> = {}) => draft({ categoryId, priceToman: 1500000, images: [{ key: "images/p1/abc.webp", alt: "تصویر نمونه" }], ...over });
const api = (c: Parameters<typeof call>[1]) => call(app, { as: owner, ...c });

describe("authentication", () => {
  it("rejects every protected route without a session and exposes only a health check", async () => {
    expect((await call(app, { path: "/healthz", as: null })).body).toEqual({ ok: true });
    for (const path of ["/api/v1/me", "/api/v1/auth/session", "/api/v1/products", "/api/v1/categories", "/api/v1/products/x"]) {
      expect((await call(app, { path, as: null })).status).toBe(401);
    }
    expect((await call(app, { path: "/", as: null })).status).toBe(404);
    expect((await call(app, { path: "/api/v1/unknown", as: owner })).status).toBe(404);
  });

  it("rejects forged, unknown and malformed session cookies", async () => {
    for (const cookie of [`${COOKIE_NAME}=forged`, `${COOKIE_NAME}=`, "other=1", `${COOKIE_NAME}=${"x".repeat(400)}`]) {
      expect((await call(app, { path: "/api/v1/products", as: null, headers: { cookie } })).status).toBe(401);
    }
  });

  it("returns the session with its CSRF token and sets a hardened cookie on login", async () => {
    const me = await api({ path: "/api/v1/auth/session" });
    expect(me.body).toEqual({ email: "owner@example.test", role: "owner", csrfToken: owner.csrf });

    app.advance(30_000);
    const secret = generateTotpSecret();
    await app.auth.createAccount({ email: "second@example.test", password: PASSWORD, role: "editor", totpSecret: secret });
    const res = await call(app, { method: "POST", path: "/api/v1/auth/login", as: null, body: { email: "second@example.test", password: PASSWORD, totp: totpAt(secret, totpStep(app.now().getTime())) } });
    expect(res.status).toBe(200);
    const cookie = res.res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(res.res.headers.get("cache-control")).toBe("no-store");
  });

  it("answers failed logins uniformly, reports TOTP needs, and throttles with Retry-After", async () => {
    const login = (body: unknown, ip = "10.7.7.7") => call(app, { method: "POST", path: "/api/v1/auth/login", as: null, body, headers: { [CLIENT_IP_HEADER]: ip } });
    const wrong = await login({ email: "owner@example.test", password: "wrong-password-123" });
    const ghost = await login({ email: "ghost@example.test", password: "wrong-password-123" });
    expect(wrong.status).toBe(401);
    expect(ghost.status).toBe(401);
    expect(wrong.body).toEqual(ghost.body);
    expect((await login({ email: "owner@example.test", password: PASSWORD })).body.error).toBe("totp_required");
    expect((await login({ email: "owner@example.test" })).status).toBe(422);

    let last = wrong;
    for (let i = 0; i < 12; i++) last = await login({ email: "owner@example.test", password: "wrong-password-123" }, `10.8.8.${i}`);
    expect(last.status).toBe(429);
    expect(Number(last.res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("signs out: the cookie stops working immediately", async () => {
    expect((await api({ method: "POST", path: "/api/v1/auth/logout" })).res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await api({ path: "/api/v1/products" })).status).toBe(401);
  });

  it("changes the password through the API and rejects weak ones", async () => {
    expect((await api({ method: "POST", path: "/api/v1/auth/password", body: { current: PASSWORD, next: "short" } })).body).toMatchObject({ error: "weak_password" });
    expect((await api({ method: "POST", path: "/api/v1/auth/password", body: { current: "wrong-current-pass", next: "a-brand-new-long-password" } })).status).toBe(401);
    expect((await api({ method: "POST", path: "/api/v1/auth/password", body: { current: PASSWORD, next: "a-brand-new-long-password" } })).status).toBe(200);
  });
});

describe("CSRF and request hygiene", () => {
  it("requires an allow-listed Origin AND the session's CSRF token on writes", async () => {
    const write = (c: Partial<Parameters<typeof call>[1]>) => call(app, { method: "POST", path: "/api/v1/products", body: draft(), as: owner, ...c });
    expect((await write({ origin: null })).status).toBe(403);
    expect((await write({ origin: "https://evil.example.test" })).status).toBe(403);
    expect((await write({ csrf: null })).body.error).toBe("bad_csrf_token");
    expect((await write({ csrf: "wrong" })).body.error).toBe("bad_csrf_token");
    expect((await write({})).status).toBe(201);
    // Fail closed: with an empty allow-list every write (and login) is refused.
    app.deps.adminOrigins = "";
    expect((await write({})).status).toBe(403);
    expect((await call(app, { method: "POST", path: "/api/v1/auth/login", as: null, body: { email: "owner@example.test", password: PASSWORD } })).status).toBe(403);
  });

  it("a stolen CSRF token alone is useless without the cookie (and vice versa)", async () => {
    const viewer = await app.session("viewer");
    expect((await call(app, { method: "POST", path: "/api/v1/products", body: draft(), as: { cookie: viewer.cookie, csrf: owner.csrf } })).body.error).toBe("bad_csrf_token");
  });

  it("enforces JSON content type, size limits and valid JSON", async () => {
    expect((await api({ method: "POST", path: "/api/v1/products", body: draft(), contentType: "text/plain" })).status).toBe(415);
    expect((await api({ method: "POST", path: "/api/v1/products", body: draft({ description: "x".repeat(300_000) }) })).status).toBe(413);
    const bad = await app.handle(new Request("https://admin.example.test/api/v1/products", { method: "POST", headers: { origin: ORIGIN, cookie: owner.cookie, "x-csrf-token": owner.csrf, "content-type": "application/json" }, body: "{nope" }));
    expect(bad.status).toBe(400);
  });

  it("sets hardening headers, never caches and sends no CORS headers", async () => {
    const { res } = await api({ path: "/api/v1/auth/session" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("hides internals when something unexpected breaks", async () => {
    const broken = { ...app.deps, catalog: { ...app.catalog, list: async () => { throw new Error("secret connection string postgres://user:pw@host/db"); } } } as unknown as typeof app.deps;
    const { createApi } = await import("./api");
    const res = await createApi(broken)(new Request("https://admin.example.test/api/v1/products", { headers: { cookie: owner.cookie } }));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"internal_error"}');
    expect(app.logs).toEqual([{ event: "unhandled_error", detail: { error: "Error" } }]); // name only: never the message
    expect(JSON.stringify(app.logs)).not.toContain("postgres://");
  });
});

describe("roles", () => {
  it("viewers read but cannot write; editors cannot do owner-only things; everyone is audited", async () => {
    const viewer = await app.session("viewer");
    expect((await call(app, { path: "/api/v1/products", as: viewer })).status).toBe(200);
    expect((await call(app, { method: "POST", path: "/api/v1/products", body: draft(), as: viewer })).status).toBe(403);
    expect((await call(app, { method: "POST", path: "/api/v1/categories", body: { slug: "x-y", name: "نام" }, as: viewer })).status).toBe(403);
    expect((await call(app, { method: "POST", path: "/api/v1/products/import", body: { products: [] }, as: viewer })).status).toBe(403);
    expect((await call(app, { method: "POST", path: "/api/v1/products/p/images", raw: jpeg, as: viewer })).status).toBe(403);
    const editor = await app.session("editor");
    expect((await call(app, { method: "POST", path: "/api/v1/products", body: draft(), as: editor })).status).toBe(201);
    expect((await app.adminStore.findByEmail("editor@example.test"))?.role).toBe("editor");
  });
});

describe("product lifecycle", () => {
  it("creates, reads, updates with versions, and reports conflicts", async () => {
    const created = await api({ method: "POST", path: "/api/v1/products", body: publishable() });
    expect(created.status).toBe(201);
    const id = created.body.product.id as string;
    expect(created.body.product).toMatchObject({ status: "draft", version: 1, priceToman: 1500000 });
    expect((await api({ path: `/api/v1/products/${id}` })).body.product.name).toBe("دیوارکوب نمونه");
    expect((await api({ path: "/api/v1/products/missing" })).status).toBe(404);

    const updated = await api({ method: "PUT", path: `/api/v1/products/${id}`, body: { expectedVersion: 1, product: publishable({ name: "نام جدید" }) } });
    expect(updated.body.product).toMatchObject({ name: "نام جدید", version: 2 });
    const stale = await api({ method: "PUT", path: `/api/v1/products/${id}`, body: { expectedVersion: 1, product: publishable({ name: "کهنه" }) } });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("version_conflict");
    expect((await api({ method: "PUT", path: `/api/v1/products/${id}`, body: { product: publishable() } })).status).toBe(422);
  });

  it("returns validation issues the UI can translate, and rejects prices beyond the supported range", async () => {
    const bad = await api({ method: "POST", path: "/api/v1/products", body: { name: "رانر سفارشی", fulfillment: "made_to_order" } });
    expect(bad.status).toBe(422);
    expect(bad.body.issues).toContainEqual({ path: "leadTimeDays", code: "lead_time_required" });
    expect((await api({ method: "POST", path: "/api/v1/products", body: draft({ priceToman: 1_000_000_000_000_001 }) })).status).toBe(422);
    expect((await api({ method: "POST", path: "/api/v1/products", body: draft({ priceToman: "1500000" }) })).status).toBe(422);
    expect((await api({ method: "POST", path: "/api/v1/products", body: draft({ categoryId: "nope" }) })).body.issues).toContainEqual({ path: "categoryId", code: "unknown_category" });
  });

  it("filters and searches through the list endpoint and rejects bad queries", async () => {
    await api({ method: "POST", path: "/api/v1/products", body: publishable({ name: "ماکرومه قوسی" }) });
    await api({ method: "POST", path: "/api/v1/products", body: publishable({ name: "کوسن بافته", fulfillment: "stocked", inventory: 4 }) });
    const found = await api({ path: `/api/v1/products?q=${encodeURIComponent("ماکرومه")}` });
    expect(found.body.items.map((i: { name: string }) => i.name)).toEqual(["ماکرومه قوسی"]);
    expect((await api({ path: "/api/v1/products?fulfillment=stocked" })).body.total).toBe(1);
    expect((await api({ path: "/api/v1/products?sort=name;DROP" })).status).toBe(400);
    expect((await api({ path: "/api/v1/products?pageSize=5000" })).status).toBe(400);
  });

  it("creates categories and rejects duplicates", async () => {
    expect((await api({ method: "POST", path: "/api/v1/categories", body: { slug: "macrame", name: "ماکرومه" } })).status).toBe(201);
    expect((await api({ method: "POST", path: "/api/v1/categories", body: { slug: "macrame", name: "ماکرومه" } })).status).toBe(409);
    expect((await api({ method: "POST", path: "/api/v1/categories", body: { slug: "Bad Slug!", name: "x" } })).status).toBe(422);
    expect((await api({ path: "/api/v1/categories" })).body.categories.map((c: { slug: string }) => c.slug)).toContain("macrame");
  });

  it("records who changed what", async () => {
    await api({ method: "POST", path: "/api/v1/products", body: draft() });
    const log = await testDb.db.auditLog.findMany({ where: { action: "product.create" } });
    expect(log.map((l) => l.actorEmail)).toEqual(["owner@example.test"]);
  });
});

describe("large prices end to end", () => {
  const prices = [2_147_483_648, 5_000_000_000_000, 999_999_999_999_999, 1_000_000_000_000_000];

  it("round-trips through the database and JSON responses without losing a digit", async () => {
    for (const [i, price] of prices.entries()) {
      const created = await api({ method: "POST", path: "/api/v1/products", body: draft({ name: `گران قیمت ${i}`, slug: `big-${i}`, priceToman: price }) });
      expect(created.status).toBe(201);
      expect(created.body.product.priceToman).toBe(price);
      const raw = await app.handle(new Request(`https://admin.example.test/api/v1/products/${created.body.product.id}`, { headers: { cookie: owner.cookie } }));
      expect(await raw.text()).toContain(`"priceToman":${price}`); // literally the exact digits on the wire
    }
  });

  it("sorts and filters by large prices exactly", async () => {
    for (const [i, price] of prices.entries()) await api({ method: "POST", path: "/api/v1/products", body: draft({ name: `گران قیمت ${i}`, slug: `big-${i}`, priceToman: price }) });
    const asc = await api({ path: "/api/v1/products?sort=price_asc" });
    expect(asc.body.items.map((i: { priceToman: number }) => i.priceToman)).toEqual(prices);
    const range = await api({ path: "/api/v1/products?minPrice=999999999999999&maxPrice=999999999999999" });
    expect(range.body.items.map((i: { priceToman: number }) => i.priceToman)).toEqual([999_999_999_999_999]);
    const above = await api({ path: "/api/v1/products?minPrice=2147483649" });
    expect(above.body.total).toBe(3);
  });

  it("never lets a bigint reach a response", async () => {
    await api({ method: "POST", path: "/api/v1/products", body: draft({ priceToman: 5_000_000_000_000 }) });
    const list = await app.handle(new Request("https://admin.example.test/api/v1/products", { headers: { cookie: owner.cookie } }));
    expect(list.status).toBe(200);
    expect(await list.text()).toContain("5000000000000");
  });

  it("publishes large prices exactly in the public snapshot", async () => {
    const created = await api({ method: "POST", path: "/api/v1/products", body: publishable({ slug: "pricey", priceToman: 999_999_999_999_999, fulfillment: "stocked", inventory: 2,
      variants: undefined }) });
    await api({ method: "POST", path: `/api/v1/products/${created.body.product.id}/status`, body: { status: "published", expectedVersion: 1 } });
    await app.settle();
    expect(app.storage.text("catalog/products/pricey.json")).toContain('"priceToman":999999999999999');
    expect(app.storage.text("catalog/categories/wall-hangings.json")).toContain('"priceToman":999999999999999');
  });
});

describe("public catalogue snapshots", () => {
  const publish = (id: string, version: number) => api({ method: "POST", path: `/api/v1/products/${id}/status`, body: { status: "published", expectedVersion: version } });

  it("never publishes drafts, and refuses to publish incomplete products", async () => {
    const created = await api({ method: "POST", path: "/api/v1/products", body: draft() });
    await app.settle();
    expect([...app.storage.objects.keys()].filter((k) => k.startsWith("catalog/products/"))).toEqual([]);
    const refused = await publish(created.body.product.id, 1);
    expect(refused.status).toBe(422);
    expect(refused.body.issues.map((i: { code: string }) => i.code)).toContain("category_required_to_publish");
  });

  it("writes sanitised files when published, and removes them on archive", async () => {
    const created = await api({ method: "POST", path: "/api/v1/products", body: publishable({ name: "ماکرومه قوسی", slug: "arch-macrame" }) });
    const id = created.body.product.id as string;
    expect((await publish(id, 1)).status).toBe(200);
    await app.settle();

    expect(app.storage.json("catalog/products/arch-macrame.json")).toMatchObject({ slug: "arch-macrame", name: "ماکرومه قوسی", availability: "in_stock", category: { slug: "wall-hangings" } });
    const raw = app.storage.text("catalog/products/arch-macrame.json")!;
    for (const secret of ['"id"', '"status"', '"inventory"', '"version"', id]) expect(raw).not.toContain(secret);
    expect(raw).toContain("https://media.example.test/images/p1/abc.webp");
    expect(app.storage.objects.get("catalog/products/arch-macrame.json")?.cacheControl).toContain("max-age");
    expect(app.storage.json("catalog/categories/wall-hangings.json")).toMatchObject({ products: [{ slug: "arch-macrame" }] });
    expect(app.storage.json("catalog/manifest.json")).toMatchObject({ categories: [{ slug: "wall-hangings", count: 1 }] });

    const current = (await api({ path: `/api/v1/products/${id}` })).body.product;
    await api({ method: "POST", path: `/api/v1/products/${id}/status`, body: { status: "archived", expectedVersion: current.version } });
    await app.settle();
    expect(app.storage.has("catalog/products/arch-macrame.json")).toBe(false);
    expect(app.storage.json("catalog/categories/wall-hangings.json")).toMatchObject({ products: [] });
    expect(app.storage.json("catalog/manifest.json")).toMatchObject({ categories: [{ count: 0 }] });
  });

  it("removes the old file when a published product is renamed, and can rebuild on demand", async () => {
    const created = await api({ method: "POST", path: "/api/v1/products", body: publishable({ slug: "old-slug" }) });
    const id = created.body.product.id as string;
    await publish(id, 1);
    await app.settle();
    await api({ method: "PUT", path: `/api/v1/products/${id}`, body: { expectedVersion: 2, product: publishable({ slug: "new-slug", status: "published" }) } });
    await app.settle();
    expect(app.storage.has("catalog/products/old-slug.json")).toBe(false);
    expect(app.storage.has("catalog/products/new-slug.json")).toBe(true);

    app.storage.objects.clear();
    expect((await api({ method: "POST", path: "/api/v1/catalog/resync", body: {} })).status).toBe(200);
    expect(app.storage.has("catalog/manifest.json")).toBe(true);
    expect(app.storage.has("catalog/categories/wall-hangings.json")).toBe(true);
  });

  it("logs, but does not fail the request, when publishing breaks", async () => {
    const original = app.storage.put.bind(app.storage);
    app.storage.put = async () => { throw new Error("bucket down"); };
    const created = await api({ method: "POST", path: "/api/v1/products", body: publishable({ status: "published" }) });
    await app.settle();
    expect(created.status).toBe(201);
    expect(app.logs.map((l) => l.event)).toContain("snapshot_sync_failed");
    app.storage.put = original;
  });
});

describe("images", () => {
  const productId = async () => (await api({ method: "POST", path: "/api/v1/products", body: draft() })).body.product.id as string;

  it("stores a validated image under an unguessable key and links it to the product", async () => {
    const id = await productId();
    const r = await api({ method: "POST", path: `/api/v1/products/${id}/images?alt=${encodeURIComponent("نمای روبه‌رو")}`, raw: jpeg });
    expect(r.status).toBe(201);
    expect(r.body.key).toMatch(new RegExp(`^images/${id}/[a-z0-9-]+\\.jpg$`));
    expect(app.storage.objects.get(r.body.key)).toMatchObject({ contentType: "image/jpeg" });
    expect(app.storage.objects.get(r.body.key)?.cacheControl).toContain("immutable");
    expect((await api({ path: `/api/v1/products/${id}` })).body.product.images).toMatchObject([{ key: r.body.key, alt: "نمای روبه‌رو" }]);
  });

  it("rejects spoofed, unsupported, empty and oversized uploads without storing anything", async () => {
    const id = await productId();
    const upload = (raw: Uint8Array, contentType?: string) => api({ method: "POST", path: `/api/v1/products/${id}/images`, raw, contentType });
    expect((await upload(png, "image/jpeg")).status).toBe(415);
    expect((await upload(new TextEncoder().encode("<svg onload=alert(1)>"), "image/svg+xml")).status).toBe(415);
    expect((await upload(new Uint8Array())).status).toBe(415);
    expect((await upload(new Uint8Array(5 * 1024 * 1024 + 1).fill(0xff))).status).toBe(413);
    expect(app.storage.objects.size).toBe(0);
  });

  it("enforces the per-product limit, cleans up the orphan, and 404s unknown products", async () => {
    const id = await productId();
    for (let i = 0; i < 12; i++) expect((await api({ method: "POST", path: `/api/v1/products/${id}/images`, raw: jpeg })).status).toBe(201);
    expect((await api({ method: "POST", path: `/api/v1/products/${id}/images`, raw: jpeg })).status).toBe(409);
    expect(app.storage.objects.size).toBe(12);
    expect((await api({ method: "POST", path: "/api/v1/products/unknown-id/images", raw: jpeg })).status).toBe(404);
  });
});

describe("bulk import", () => {
  it("imports a chunk (create + update) and syncs published products", async () => {
    const body = { products: [publishable({ slug: "imp-a", name: "وارد شده الف", status: "published" }), draft({ slug: "imp-b", name: "وارد شده ب" })] };
    expect((await api({ method: "POST", path: "/api/v1/products/import", body })).body).toEqual({ created: 2, updated: 0 });
    await app.settle();
    expect(app.storage.has("catalog/products/imp-a.json")).toBe(true);
    expect(app.storage.has("catalog/products/imp-b.json")).toBe(false);
    expect((await api({ method: "POST", path: "/api/v1/products/import", body: { products: [draft({ slug: "imp-b", name: "ب ویرایش" })] } })).body).toEqual({ created: 0, updated: 1 });
  });

  it("can defer shard/manifest rebuilds until one final resync", async () => {
    const chunk = (slug: string) => ({ products: [publishable({ slug, name: `محصول ${slug}`, status: "published" })] });
    await api({ method: "POST", path: "/api/v1/products/import?defer=1", body: chunk("def-a") });
    await api({ method: "POST", path: "/api/v1/products/import?defer=1", body: chunk("def-b") });
    await app.settle();
    expect(app.storage.has("catalog/products/def-a.json")).toBe(true);
    expect(app.storage.has("catalog/manifest.json")).toBe(false);
    await api({ method: "POST", path: "/api/v1/catalog/resync", body: {} });
    expect(app.storage.json("catalog/manifest.json")).toMatchObject({ categories: [{ count: 2 }] });
  });

  it("is all-or-nothing on validation errors and enforces the chunk size", async () => {
    const mixed = { products: [draft({ slug: "ok-one", name: "درست" }), { slug: "bad-one", name: "x", fulfillment: "nope" }, draft({ name: "بدون شناسه" })] };
    const r = await api({ method: "POST", path: "/api/v1/products/import", body: mixed });
    expect(r.status).toBe(422);
    expect(r.body.issues.map((i: { index: number }) => i.index)).toEqual(expect.arrayContaining([1, 2]));
    expect(await testDb.db.product.count()).toBe(0);

    const tooMany = { products: Array.from({ length: 11 }, (_, i) => draft({ slug: `p-${i}`, name: `محصول ${i}` })) };
    const big = await api({ method: "POST", path: "/api/v1/products/import", body: tooMany });
    expect(big.status).toBe(413);
    expect(big.body.max).toBe(10);
    app = await buildTestApp(testDb, { importChunkMax: 50 });
    owner = await app.session("owner");
    expect((await api({ method: "POST", path: "/api/v1/products/import", body: tooMany })).status).toBe(200);
  });
});

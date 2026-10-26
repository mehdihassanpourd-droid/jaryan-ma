import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { handleRequest, type ExecutionContextLike, type Overrides } from "../src/index";
import { AUD, NOW, TEAM, makeKey, signJwt, type TestKey } from "./jwt-helper";
import { FakeBucket, createTestDb, seedAdmin, seedCategory, sql } from "./d1-shim";

const ORIGIN = "https://admin.example.test";
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

let key: TestKey;
let env: Env;
let bucket: FakeBucket;
let pending: Promise<unknown>[];
let overrides: Overrides;
let counter = 0;

const ctx: ExecutionContextLike = { waitUntil: (p) => void pending.push(p) };
const settle = async () => { await Promise.all(pending); pending = []; };

beforeAll(async () => { key = await makeKey(); });

beforeEach(async () => {
  counter = 0;
  pending = [];
  bucket = new FakeBucket();
  const db = createTestDb();
  await seedAdmin(db, "owner@example.test", "owner");
  await seedAdmin(db, "editor@example.test", "editor");
  await seedAdmin(db, "viewer@example.test", "viewer");
  await seedAdmin(db, "disabled@example.test", "editor", 1);
  await seedCategory(db, "c1", "wall-hangings", "دیوارکوب بافته");
  env = { DB: db, BUCKET: bucket, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_ORIGINS: ORIGIN, PUBLIC_BUCKET_URL: "https://cdn.example.test" };
  overrides = { getKeys: async () => [key.publicJwk], now: () => NOW, deps: { now: () => "2026-03-01T00:00:00.000Z", uuid: () => `id-${++counter}` } };
});

interface Call { method?: string; path: string; as?: string | null; body?: unknown; origin?: string | null; headers?: Record<string, string>; raw?: Uint8Array; contentType?: string }
// Response shapes are asserted individually in each test, so the body is left loosely typed here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(c: Call): Promise<{ status: number; body: any; res: Response }> {
  const headers: Record<string, string> = { ...c.headers };
  if (c.as !== null) headers["cf-access-jwt-assertion"] = await signJwt(key, { claims: { email: c.as ?? "owner@example.test" } });
  const method = c.method ?? "GET";
  if (method !== "GET" && c.origin !== null) headers.origin = c.origin ?? ORIGIN;
  let body: BodyInit | undefined;
  if (c.raw) { body = c.raw as unknown as BodyInit; headers["content-type"] = c.contentType ?? "image/jpeg"; }
  else if (c.body !== undefined) { body = JSON.stringify(c.body); headers["content-type"] = c.contentType ?? "application/json"; }
  const res = await handleRequest(new Request(`https://admin.example.test${c.path}`, { method, headers, body }), env, ctx, overrides);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, res };
}

const draft = (over: Record<string, unknown> = {}) => ({ name: "دیوارکوب نمونه", fulfillment: "unique", ...over });
const publishable = (over: Record<string, unknown> = {}) => draft({ categoryId: "c1", priceToman: 1500000, images: [{ key: "images/p1/abc.webp", alt: "تصویر نمونه" }], ...over });

describe("fail-closed authentication", () => {
  it("refuses everything when Access is not configured", async () => {
    env = { ...env, ACCESS_TEAM_DOMAIN: undefined, ACCESS_AUD: undefined };
    expect((await call({ path: "/api/v1/products" })).status).toBe(503);
    env = { ...env, ACCESS_TEAM_DOMAIN: "evil.example.com", ACCESS_AUD: AUD };
    expect((await call({ path: "/api/v1/products" })).status).toBe(503);
  });

  it("rejects missing, invalid and forged tokens with 401", async () => {
    expect((await call({ path: "/api/v1/products", as: null })).status).toBe(401);
    expect((await call({ path: "/api/v1/products", as: null, headers: { "cf-access-jwt-assertion": "garbage" } })).status).toBe(401);
    const otherKey = await makeKey("key-1");
    const forged = await signJwt(otherKey);
    expect((await call({ path: "/api/v1/products", as: null, headers: { "cf-access-jwt-assertion": forged } })).status).toBe(401);
    const expired = await signJwt(key, { claims: { exp: NOW - 1000 } });
    expect((await call({ path: "/api/v1/products", as: null, headers: { "cf-access-jwt-assertion": expired } })).status).toBe(401);
  });

  it("rejects valid Access users that are not enabled admins with 403", async () => {
    expect((await call({ path: "/api/v1/products", as: "stranger@example.test" })).status).toBe(403);
    expect((await call({ path: "/api/v1/products", as: "disabled@example.test" })).status).toBe(403);
  });

  it("exposes no admin data without auth and only a health check publicly", async () => {
    expect((await call({ path: "/healthz", as: null })).body).toEqual({ ok: true });
    expect((await call({ path: "/api/v1/me", as: null })).status).toBe(401);
    expect((await call({ path: "/", as: null })).status).toBe(404);
    expect((await call({ path: "/api/v1/unknown" })).status).toBe(404);
  });

  it("sets hardening headers and never caches", async () => {
    const { res } = await call({ path: "/api/v1/me" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("CSRF and request hygiene", () => {
  it("requires an allow-listed Origin on state-changing requests", async () => {
    expect((await call({ method: "POST", path: "/api/v1/products", body: draft(), origin: null })).status).toBe(403);
    expect((await call({ method: "POST", path: "/api/v1/products", body: draft(), origin: "https://evil.example.test" })).status).toBe(403);
    expect((await call({ method: "POST", path: "/api/v1/products", body: draft() })).status).toBe(201);
    env = { ...env, ADMIN_ORIGINS: undefined };
    expect((await call({ method: "POST", path: "/api/v1/products", body: draft() })).status).toBe(403);
  });

  it("enforces JSON content type, size limits and valid JSON", async () => {
    expect((await call({ method: "POST", path: "/api/v1/products", body: draft(), contentType: "text/plain" })).status).toBe(415);
    expect((await call({ method: "POST", path: "/api/v1/products", body: draft({ description: "x".repeat(300_000) }) })).status).toBe(413);
    const bad = await handleRequest(
      new Request("https://admin.example.test/api/v1/products", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "cf-access-jwt-assertion": await signJwt(key, { claims: { email: "owner@example.test" } }) }, body: "{nope" }),
      env, ctx, overrides,
    );
    expect(bad.status).toBe(400);
  });
});

describe("roles", () => {
  it("viewers read but cannot write", async () => {
    expect((await call({ path: "/api/v1/products", as: "viewer@example.test" })).status).toBe(200);
    expect((await call({ method: "POST", path: "/api/v1/products", body: draft(), as: "viewer@example.test" })).status).toBe(403);
    expect((await call({ method: "POST", path: "/api/v1/categories", body: { slug: "x-y", name: "نام" }, as: "viewer@example.test" })).status).toBe(403);
    expect((await call({ method: "POST", path: "/api/v1/products/import", body: { products: [] }, as: "viewer@example.test" })).status).toBe(403);
  });

  it("reports the caller", async () => {
    expect((await call({ path: "/api/v1/me", as: "editor@example.test" })).body).toEqual({ email: "editor@example.test", role: "editor" });
  });
});

describe("product lifecycle", () => {
  it("creates, reads, updates with versions, and reports conflicts", async () => {
    const created = await call({ method: "POST", path: "/api/v1/products", body: publishable() });
    expect(created.status).toBe(201);
    const id = created.body.product.id as string;
    expect(created.body.product).toMatchObject({ status: "draft", version: 1, priceToman: 1500000 });

    expect((await call({ path: `/api/v1/products/${id}` })).body.product.name).toBe("دیوارکوب نمونه");
    expect((await call({ path: "/api/v1/products/missing" })).status).toBe(404);

    const updated = await call({ method: "PUT", path: `/api/v1/products/${id}`, body: { expectedVersion: 1, product: publishable({ name: "نام جدید" }) } });
    expect(updated.body.product).toMatchObject({ name: "نام جدید", version: 2 });

    const stale = await call({ method: "PUT", path: `/api/v1/products/${id}`, body: { expectedVersion: 1, product: publishable({ name: "کهنه" }) } });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("version_conflict");
    expect((await call({ method: "PUT", path: `/api/v1/products/${id}`, body: { product: publishable() } })).status).toBe(422);
  });

  it("returns validation issues the UI can translate", async () => {
    const bad = await call({ method: "POST", path: "/api/v1/products", body: { name: "رانر سفارشی", fulfillment: "made_to_order" } });
    expect(bad.status).toBe(422);
    expect(bad.body.issues).toContainEqual({ path: "leadTimeDays", code: "lead_time_required" });
  });

  it("filters and searches through the list endpoint and rejects bad queries", async () => {
    await call({ method: "POST", path: "/api/v1/products", body: publishable({ name: "ماکرومه قوسی" }) });
    await call({ method: "POST", path: "/api/v1/products", body: publishable({ name: "کوسن بافته", fulfillment: "stocked", inventory: 4 }) });
    const found = await call({ path: `/api/v1/products?q=${encodeURIComponent("ماکرومه")}` });
    expect(found.body.items.map((i: { name: string }) => i.name)).toEqual(["ماکرومه قوسی"]);
    expect((await call({ path: "/api/v1/products?fulfillment=stocked" })).body.total).toBe(1);
    expect((await call({ path: "/api/v1/products?sort=name;DROP" })).status).toBe(400);
    expect((await call({ path: "/api/v1/products?pageSize=5000" })).status).toBe(400);
  });

  it("creates categories and rejects duplicates", async () => {
    expect((await call({ method: "POST", path: "/api/v1/categories", body: { slug: "macrame", name: "ماکرومه" } })).status).toBe(201);
    expect((await call({ method: "POST", path: "/api/v1/categories", body: { slug: "macrame", name: "ماکرومه" } })).status).toBe(409);
    expect((await call({ method: "POST", path: "/api/v1/categories", body: { slug: "Bad Slug!", name: "x" } })).status).toBe(422);
    expect((await call({ path: "/api/v1/categories" })).body.categories.map((c: { slug: string }) => c.slug)).toContain("macrame");
  });
});

describe("public catalogue snapshots", () => {
  const publish = async (id: string, version: number) => call({ method: "POST", path: `/api/v1/products/${id}/status`, body: { status: "published", expectedVersion: version } });

  it("never publishes drafts, and refuses to publish incomplete products", async () => {
    const created = await call({ method: "POST", path: "/api/v1/products", body: draft() });
    await settle();
    expect([...bucket.objects.keys()].filter((k) => k.startsWith("catalog/products/"))).toEqual([]);
    const refused = await publish(created.body.product.id, 1);
    expect(refused.status).toBe(422);
    expect(refused.body.issues.map((i: { code: string }) => i.code)).toContain("category_required_to_publish");
  });

  it("writes sanitised product, category and manifest files when published, and removes them on archive", async () => {
    const created = await call({ method: "POST", path: "/api/v1/products", body: publishable({ name: "ماکرومه قوسی", slug: "arch-macrame" }) });
    const id = created.body.product.id as string;
    expect((await publish(id, 1)).status).toBe(200);
    await settle();

    const file = bucket.json("catalog/products/arch-macrame.json") as Record<string, unknown>;
    expect(file).toMatchObject({ slug: "arch-macrame", name: "ماکرومه قوسی", availability: "in_stock", category: { slug: "wall-hangings" } });
    expect((file.images as Array<{ url: string }>)[0]?.url).toBe("https://cdn.example.test/images/p1/abc.webp");
    const raw = String(bucket.objects.get("catalog/products/arch-macrame.json")?.body);
    for (const secret of ['"id"', '"status"', '"inventory"', '"version"', id]) expect(raw).not.toContain(secret);
    expect(bucket.objects.get("catalog/products/arch-macrame.json")?.cacheControl).toContain("max-age");

    expect(bucket.json("catalog/categories/wall-hangings.json")).toMatchObject({ products: [{ slug: "arch-macrame" }] });
    expect(bucket.json("catalog/manifest.json")).toMatchObject({ categories: [{ slug: "wall-hangings", count: 1 }] });

    const current = (await call({ path: `/api/v1/products/${id}` })).body.product;
    await call({ method: "POST", path: `/api/v1/products/${id}/status`, body: { status: "archived", expectedVersion: current.version } });
    await settle();
    expect(bucket.objects.has("catalog/products/arch-macrame.json")).toBe(false);
    expect(bucket.json("catalog/categories/wall-hangings.json")).toMatchObject({ products: [] });
    expect(bucket.json("catalog/manifest.json")).toMatchObject({ categories: [{ count: 0 }] });
  });

  it("removes the old file when a published product is renamed", async () => {
    const created = await call({ method: "POST", path: "/api/v1/products", body: publishable({ slug: "old-slug" }) });
    const id = created.body.product.id as string;
    await publish(id, 1);
    await settle();
    expect(bucket.objects.has("catalog/products/old-slug.json")).toBe(true);
    await call({ method: "PUT", path: `/api/v1/products/${id}`, body: { expectedVersion: 2, product: publishable({ slug: "new-slug", status: "published" }) } });
    await settle();
    expect(bucket.objects.has("catalog/products/old-slug.json")).toBe(false);
    expect(bucket.objects.has("catalog/products/new-slug.json")).toBe(true);
  });

  it("can rebuild shards and manifest on demand", async () => {
    await call({ method: "POST", path: "/api/v1/products", body: publishable({ status: "published" }) });
    await settle();
    bucket.objects.clear();
    expect((await call({ method: "POST", path: "/api/v1/catalog/resync", body: {} })).status).toBe(200);
    expect(bucket.objects.has("catalog/manifest.json")).toBe(true);
    expect(bucket.objects.has("catalog/categories/wall-hangings.json")).toBe(true);
  });
});

describe("images", () => {
  async function productId() {
    return (await call({ method: "POST", path: "/api/v1/products", body: draft() })).body.product.id as string;
  }

  it("stores a validated image under an unguessable key and links it to the product", async () => {
    const id = await productId();
    const r = await call({ method: "POST", path: `/api/v1/products/${id}/images?alt=${encodeURIComponent("نمای روبه‌رو")}`, raw: jpeg });
    expect(r.status).toBe(201);
    expect(r.body.key).toMatch(new RegExp(`^images/${id}/[a-z0-9-]+\\.jpg$`));
    const stored = bucket.objects.get(r.body.key);
    expect(stored).toMatchObject({ contentType: "image/jpeg" });
    expect(stored?.cacheControl).toContain("immutable");
    expect((await call({ path: `/api/v1/products/${id}` })).body.product.images).toMatchObject([{ key: r.body.key, alt: "نمای روبه‌رو" }]);
  });

  it("rejects spoofed, unsupported, empty and oversized uploads", async () => {
    const id = await productId();
    expect((await call({ method: "POST", path: `/api/v1/products/${id}/images`, raw: png, contentType: "image/jpeg" })).status).toBe(415);
    expect((await call({ method: "POST", path: `/api/v1/products/${id}/images`, raw: new TextEncoder().encode("<svg onload=alert(1)>"), contentType: "image/svg+xml" })).status).toBe(415);
    expect((await call({ method: "POST", path: `/api/v1/products/${id}/images`, raw: new Uint8Array() })).status).toBe(415);
    expect((await call({ method: "POST", path: `/api/v1/products/${id}/images`, raw: new Uint8Array(5 * 1024 * 1024 + 1).fill(0xff) })).status).toBe(413);
    expect(bucket.objects.size).toBe(0);
  });

  it("enforces the per-product limit and cleans up the orphaned object", async () => {
    const id = await productId();
    for (let i = 0; i < 12; i++) expect((await call({ method: "POST", path: `/api/v1/products/${id}/images`, raw: jpeg })).status).toBe(201);
    const extra = await call({ method: "POST", path: `/api/v1/products/${id}/images`, raw: jpeg });
    expect(extra.status).toBe(409);
    expect(bucket.objects.size).toBe(12);
    expect((await call({ method: "POST", path: "/api/v1/products/unknown-id/images", raw: jpeg })).status).toBe(404);
  });
});

describe("bulk import", () => {
  it("imports a chunk (create + update) and syncs published products", async () => {
    const body = { products: [publishable({ slug: "imp-a", name: "وارد شده الف", status: "published" }), draft({ slug: "imp-b", name: "وارد شده ب" })] };
    const r = await call({ method: "POST", path: "/api/v1/products/import", body });
    expect(r.body).toEqual({ created: 2, updated: 0 });
    await settle();
    expect(bucket.objects.has("catalog/products/imp-a.json")).toBe(true);
    expect(bucket.objects.has("catalog/products/imp-b.json")).toBe(false);

    const again = await call({ method: "POST", path: "/api/v1/products/import", body: { products: [draft({ slug: "imp-b", name: "ب ویرایش" })] } });
    expect(again.body).toEqual({ created: 0, updated: 1 });
  });

  it("can defer shard/manifest rebuilds until one final resync", async () => {
    const chunk = (slug: string) => ({ products: [publishable({ slug, name: `محصول ${slug}`, status: "published" })] });
    expect((await call({ method: "POST", path: "/api/v1/products/import?defer=1", body: chunk("def-a") })).status).toBe(200);
    expect((await call({ method: "POST", path: "/api/v1/products/import?defer=1", body: chunk("def-b") })).status).toBe(200);
    await settle();
    expect(bucket.objects.has("catalog/products/def-a.json")).toBe(true);
    expect(bucket.objects.has("catalog/manifest.json")).toBe(false);
    expect(bucket.objects.has("catalog/categories/wall-hangings.json")).toBe(false);
    await call({ method: "POST", path: "/api/v1/catalog/resync", body: {} });
    expect(bucket.json("catalog/categories/wall-hangings.json")).toMatchObject({ products: [{ slug: expect.any(String) }, { slug: expect.any(String) }] });
    expect(bucket.json("catalog/manifest.json")).toMatchObject({ categories: [{ count: 2 }] });
  });

  it("is all-or-nothing on validation errors and enforces the chunk size", async () => {
    const mixed = { products: [draft({ slug: "ok-one", name: "درست" }), { slug: "bad-one", name: "x", fulfillment: "nope" }, draft({ name: "بدون شناسه" })] };
    const r = await call({ method: "POST", path: "/api/v1/products/import", body: mixed });
    expect(r.status).toBe(422);
    expect(r.body.issues.map((i: { index: number }) => i.index)).toEqual(expect.arrayContaining([1, 2]));
    expect(await sql(env.DB, "SELECT slug FROM products")).toEqual([]);

    const tooMany = { products: Array.from({ length: 11 }, (_, i) => draft({ slug: `p-${i}`, name: `محصول ${i}` })) };
    const big = await call({ method: "POST", path: "/api/v1/products/import", body: tooMany });
    expect(big.status).toBe(413);
    expect(big.body.max).toBe(10);
    env = { ...env, IMPORT_CHUNK_MAX: "50" };
    expect((await call({ method: "POST", path: "/api/v1/products/import", body: tooMany })).status).toBe(200);
  });
});

describe("audit trail", () => {
  it("records who changed what", async () => {
    await call({ method: "POST", path: "/api/v1/products", body: draft(), as: "editor@example.test" });
    expect(await sql(env.DB, "SELECT actor_email, action FROM audit_log")).toEqual([{ actor_email: "editor@example.test", action: "product.create" }]);
  });
});

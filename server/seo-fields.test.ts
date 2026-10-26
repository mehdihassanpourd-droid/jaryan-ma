/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted field by field */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "./db/test-database";
import { buildTestApp, call, type Session, type TestApp } from "./testing/app";

let testDb: TestDatabase;
let app: TestApp;
let owner: Session;

beforeAll(async () => void (testDb = await createTestDatabase()), 60_000);
afterAll(async () => testDb.close());
beforeEach(async () => {
  app = await buildTestApp(testDb);
  owner = await app.session("owner");
});

const api = (c: Parameters<typeof call>[1]) => call(app, { as: owner, ...c });
const input = (over: Record<string, unknown> = {}) => ({ name: "اثر آزمایشی", fulfillment: "unique", ...over });

describe("SEO title and description through the product API", () => {
  it("round-trips, is kept by an update that does not mention it, and is cleared by null or blank", async () => {
    const created = await api({ method: "POST", path: "/api/v1/products", body: input({ seoTitle: "عنوان سئو", seoDescription: "شرح سئو" }) });
    expect(created.status).toBe(201);
    expect(created.body.product).toMatchObject({ seoTitle: "عنوان سئو", seoDescription: "شرح سئو" });
    const { id, version } = created.body.product;

    // an update from a client that knows nothing about SEO fields must not erase them
    const kept = await api({ method: "PUT", path: `/api/v1/products/${id}`, body: { expectedVersion: version, product: input({ name: "نام جدید" }) } });
    expect(kept.body.product).toMatchObject({ name: "نام جدید", seoTitle: "عنوان سئو", seoDescription: "شرح سئو" });

    const cleared = await api({ method: "PUT", path: `/api/v1/products/${id}`, body: { expectedVersion: kept.body.product.version, product: input({ name: "نام جدید", seoTitle: null, seoDescription: "  " }) } });
    expect(cleared.body.product).toMatchObject({ seoTitle: null, seoDescription: null });
  });

  it("rejects over-long values at the API and at the database", async () => {
    const tooLong = await api({ method: "POST", path: "/api/v1/products", body: input({ seoTitle: "ا".repeat(71) }) });
    expect(tooLong).toMatchObject({ status: 422, body: { error: "validation_failed" } });
    const created = await api({ method: "POST", path: "/api/v1/products", body: input() });
    await expect(testDb.db.product.update({ where: { id: created.body.product.id }, data: { seoTitle: "ا".repeat(71) } })).rejects.toThrow();
    await expect(testDb.db.product.update({ where: { id: created.body.product.id }, data: { seoDescription: "ا".repeat(161) } })).rejects.toThrow();
  });

  it("reaches the public snapshot of a published product", async () => {
    const category = await api({ method: "POST", path: "/api/v1/categories", body: { slug: "wall", name: "دیوارکوب" } });
    const created = await api({
      method: "POST",
      path: "/api/v1/products",
      body: input({ categoryId: category.body.category.id, priceToman: 1_000_000, seoTitle: "عنوان ویژه", images: [{ key: "images/p1/a.webp", alt: "تصویر" }], status: "published" }),
    });
    expect(created.status).toBe(201);
    await app.settle();
    const published = app.storage.json(`catalog/products/${created.body.product.slug}.json`) as any;
    expect(published).toMatchObject({ seoTitle: "عنوان ویژه", seoDescription: null });
  });

  it("CSV import without SEO columns keeps the stored text; with the columns it overwrites it", async () => {
    const created = await api({ method: "POST", path: "/api/v1/products", body: input({ slug: "اثر-سئو", seoTitle: "نگه‌داشته شود", seoDescription: "این هم" }) });
    expect(created.status).toBe(201);
    const row = { slug: "اثر-سئو", name: "اثر آزمایشی", fulfillment: "unique", inventory: 1, status: "draft", description: "", priceToman: null, leadTimeDays: null, categoryId: null, images: [], variants: [] };
    const keep = await api({ method: "POST", path: "/api/v1/products/import", body: { products: [row] } });
    expect(keep.body).toEqual({ created: 0, updated: 1 });
    expect((await api({ path: `/api/v1/products/${created.body.product.id}` })).body.product).toMatchObject({ seoTitle: "نگه‌داشته شود", seoDescription: "این هم" });
    await api({ method: "POST", path: "/api/v1/products/import", body: { products: [{ ...row, seoTitle: null, seoDescription: "جدید" }] } });
    expect((await api({ path: `/api/v1/products/${created.body.product.id}` })).body.product).toMatchObject({ seoTitle: null, seoDescription: "جدید" });
  });
});

describe("what the admin UI is told about the signed-in user", () => {
  it("lists exactly the permitted actions per role, plus the media base URL", async () => {
    const perms = async (role: "owner" | "editor" | "support" | "viewer") => {
      const s = await app.session(role);
      const me = await call(app, { path: "/api/v1/auth/session", as: s });
      expect(me.body).toMatchObject({ role, mediaBaseUrl: "https://media.example.test", csrfToken: s.csrf });
      return me.body.permissions as string[];
    };
    const viewer = await perms("viewer");
    expect(viewer).toEqual(["product:read"]);
    const support = await perms("support");
    expect(support).toContain("support:reply");
    expect(support).not.toContain("product:write");
    const editor = await perms("editor");
    expect(editor).toEqual(expect.arrayContaining(["product:write", "product:publish", "product:import", "image:upload", "category:write"]));
    expect(editor).not.toContain("maintenance:write");
    expect((await perms("owner")).length).toBeGreaterThan(editor.length);
  });
});

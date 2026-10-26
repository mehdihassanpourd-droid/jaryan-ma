import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "../../src/domain/errors";
import { parseProductListQuery } from "../../src/domain/product/query";
import { validateProductInput, type ImportProductInput, type ProductInput } from "../../src/domain/product/schema";
import type { Db } from "../db/client";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { ensureDefaultVendor } from "../db/vendor";
import { PrismaCatalogRepository } from "./prisma-repository";
import { CatalogService } from "./service";

const ACTOR = "owner@example.test";
let testDb: TestDatabase;
let db: Db;
let repo: PrismaCatalogRepository;
let service: CatalogService;
let c1: string;
let c2: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = testDb.db;
}, 60_000);
afterAll(async () => {
  await testDb.close();
});

beforeEach(async () => {
  await testDb.reset();
  const vendorId = await ensureDefaultVendor(db);
  repo = new PrismaCatalogRepository(db, vendorId);
  service = new CatalogService(repo);
  c1 = (await repo.createCategory({ slug: "wall-hangings", name: "دیوارکوب بافته" })).id;
  c2 = (await repo.createCategory({ slug: "home-decor", name: "دکور خانه" })).id;
});

function input(raw: Record<string, unknown>): ProductInput {
  const r = validateProductInput({ fulfillment: "unique", ...raw });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}
const forImport = (raw: Record<string, unknown>): ImportProductInput => ({ ...input(raw), slug: String(raw.slug) });
const img = (n: string) => ({ key: `images/p/${n}.webp`, alt: `تصویر ${n}` });
const list = async (qs = "") => {
  const q = parseProductListQuery(new URLSearchParams(qs));
  if (!q.ok) throw new Error("bad query");
  return repo.listProducts(q.value);
};

describe("create / get", () => {
  it("stores a unique product with images and returns it", async () => {
    const created = await service.create(input({ name: "دیوارکوب نمونه", description: "توضیح", categoryId: c1, priceToman: 1500000, images: [img("a"), img("b")] }), ACTOR);
    expect(created).toMatchObject({ slug: "دیوارکوب-نمونه", status: "draft", fulfillment: "unique", inventory: 1, priceToman: 1500000, version: 1, publishedAt: null });
    expect(created.images.map((i) => i.key)).toEqual(["images/p/a.webp", "images/p/b.webp"]);
    expect(await repo.getProduct(created.id)).toEqual(created);
    expect(await repo.getProduct("missing")).toBeNull();
  });

  it("stores variants for stocked and made-to-order products", async () => {
    const stocked = await service.create(input({ name: "کوسن نمونه", fulfillment: "stocked", priceToman: 500, variants: [{ sku: "K-S", options: { size: "S" }, inventory: 2 }, { sku: "K-L", options: { size: "L" }, inventory: 0, priceToman: 700 }] }), ACTOR);
    expect(stocked.variants).toHaveLength(2);
    expect(stocked.variants[1]).toMatchObject({ sku: "K-L", priceToman: 700, inventory: 0, options: { size: "L" } });
    const mto = await service.create(input({ name: "رانر سفارشی", fulfillment: "made_to_order", leadTimeDays: 21 }), ACTOR);
    expect(mto).toMatchObject({ fulfillment: "made_to_order", leadTimeDays: 21, inventory: null });
  });

  it("makes generated slugs unique but reports explicit slug clashes", async () => {
    const a = await service.create(input({ name: "ماکرومه نمونه" }), ACTOR);
    const b = await service.create(input({ name: "ماکرومه نمونه" }), ACTOR);
    expect(b.slug).toBe(`${a.slug}-2`);
    await expect(service.create(input({ name: "دیگر", slug: a.slug }), ACTOR)).rejects.toMatchObject({ code: "slug_taken" });
  });

  it("rolls everything back on a duplicate SKU", async () => {
    const variant = { sku: "DUP", options: { size: "S" }, inventory: 1 };
    await service.create(input({ name: "نخست", fulfillment: "stocked", variants: [variant] }), ACTOR);
    await expect(service.create(input({ name: "دوم", fulfillment: "stocked", variants: [variant] }), ACTOR)).rejects.toMatchObject({ code: "sku_taken" });
    expect(await db.product.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(1);
  });

  it("reports an unknown category as a validation problem and audits creations", async () => {
    await expect(service.create(input({ name: "بی دسته", categoryId: "nope" }), ACTOR)).rejects.toBeInstanceOf(ValidationError);
    await service.create(input({ name: "با ثبت رخداد" }), ACTOR);
    expect((await db.auditLog.findMany()).map((a) => [a.actorEmail, a.action])).toEqual([[ACTOR, "product.create"]]);
  });
});

describe("update (optimistic concurrency)", () => {
  it("replaces fields and children and bumps the version", async () => {
    const p = await service.create(input({ name: "نخست", images: [img("a")] }), ACTOR);
    const updated = await service.update(p.id, input({ name: "ویرایش‌شده", slug: p.slug, images: [img("b"), img("c")], priceToman: 900 }), 1, ACTOR);
    expect(updated).toMatchObject({ name: "ویرایش‌شده", version: 2, priceToman: 900 });
    expect(updated.images.map((i) => i.key)).toEqual(["images/p/b.webp", "images/p/c.webp"]);
  });

  it("rejects a stale version without touching children or the audit trail", async () => {
    const p = await service.create(input({ name: "نخست", images: [img("a")] }), ACTOR);
    await service.update(p.id, input({ name: "دوم", slug: p.slug, images: [img("a")] }), 1, ACTOR);
    await expect(service.update(p.id, input({ name: "کهنه", slug: p.slug, images: [img("x"), img("y")] }), 1, ACTOR)).rejects.toMatchObject({ code: "version_conflict" });
    const after = await repo.getProduct(p.id);
    expect(after).toMatchObject({ name: "دوم", version: 2 });
    expect(after?.images.map((i) => i.key)).toEqual(["images/p/a.webp"]);
    expect(await db.auditLog.count({ where: { action: "product.update" } })).toBe(1);
  });

  it("of two simultaneous writers exactly one wins", async () => {
    const p = await service.create(input({ name: "رقابت" }), ACTOR);
    const attempt = (name: string) => service.update(p.id, input({ name, slug: p.slug }), 1, ACTOR).then(() => "ok", (e: unknown) => (e as ConflictError).code);
    const results = await Promise.all([attempt("الف الف"), attempt("ب ب"), attempt("ج ج")]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "version_conflict")).toHaveLength(2);
    expect((await repo.getProduct(p.id))?.version).toBe(2);
  });

  it("reports unknown products and SKU clashes (rolled back)", async () => {
    await expect(service.update("nope", input({ name: "ناموجود" }), 1, ACTOR)).rejects.toBeInstanceOf(NotFoundError);
    await service.create(input({ name: "الف الف", fulfillment: "stocked", variants: [{ sku: "SKU-1", options: { s: "1" }, inventory: 1 }] }), ACTOR);
    const b = await service.create(input({ name: "ب ب", fulfillment: "stocked", inventory: 1 }), ACTOR);
    await expect(service.update(b.id, input({ name: "ب ب", slug: b.slug, fulfillment: "stocked", variants: [{ sku: "SKU-1", options: { s: "1" }, inventory: 1 }] }), 1, ACTOR)).rejects.toMatchObject({ code: "sku_taken" });
    expect(await repo.getProduct(b.id)).toMatchObject({ version: 1, variants: [] });
  });
});

describe("status changes", () => {
  it("publishes a complete product and stamps publishedAt once", async () => {
    const p = await service.create(input({ name: "کامل", categoryId: c1, priceToman: 100, images: [img("a")] }), ACTOR);
    const published = await service.setStatus(p.id, "published", 1, ACTOR);
    expect(published).toMatchObject({ status: "published", version: 2 });
    expect(published.publishedAt).toBeTruthy();
    const archived = await service.setStatus(p.id, "archived", 2, ACTOR);
    expect(archived).toMatchObject({ status: "archived", publishedAt: published.publishedAt });
  });

  it("refuses to publish an incomplete product and leaves it untouched", async () => {
    const p = await service.create(input({ name: "ناقص" }), ACTOR);
    const error = await service.setStatus(p.id, "published", 1, ACTOR).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues.map((i) => i.code)).toEqual(expect.arrayContaining(["category_required_to_publish", "image_required_to_publish", "price_required_to_publish"]));
    expect(await repo.getProduct(p.id)).toMatchObject({ status: "draft", version: 1 });
  });
});

describe("search and filters", () => {
  beforeEach(async () => {
    await service.create(input({ name: "دیوارکوب سبز", description: "بافته با نخ پنبه", categoryId: c1, priceToman: 1000, status: "published", images: [img("a")] }), ACTOR);
    await service.create(input({ name: "کوسن بافته", fulfillment: "stocked", categoryId: c2, priceToman: 500, status: "draft", variants: [{ sku: "CUSH-1", options: { size: "S" }, inventory: 0 }] }), ACTOR);
    await service.create(input({ name: "رانر سفارشی", fulfillment: "made_to_order", leadTimeDays: 14, categoryId: c2, priceToman: 3000, status: "published", images: [img("b")] }), ACTOR);
    await service.create(input({ name: "بایگانی‌شده", status: "archived" }), ACTOR);
  });
  const names = async (qs: string) => (await list(qs)).items.map((i) => i.name).sort();

  it("hides archived by default and shows them on request", async () => {
    expect(await names("")).toEqual(["دیوارکوب سبز", "رانر سفارشی", "کوسن بافته"]);
    expect(await names("status=archived")).toEqual(["بایگانی‌شده"]);
  });

  it("searches Persian text regardless of Arabic letters, digits or ZWNJ", async () => {
    expect(await names("q=ديوار")).toEqual(["دیوارکوب سبز"]);
    expect(await names("q=" + encodeURIComponent("بافته"))).toEqual(["دیوارکوب سبز", "کوسن بافته"]);
    expect(await names("q=CUSH-1")).toEqual(["کوسن بافته"]);
    expect(await names("q=" + encodeURIComponent("سبز بافته"))).toEqual(["دیوارکوب سبز"]);
  });

  it("treats LIKE wildcards and SQL fragments in the search text literally", async () => {
    const all = await names("");
    expect(await names("q=" + encodeURIComponent("100%"))).toEqual([]);
    expect(await names("q=%25")).toEqual(all); // a lone wildcard is ignored, never "match everything but wrongly"
    expect(await names("q=_")).toEqual(all);
    expect(await names("q=" + encodeURIComponent("دیوار_کوب"))).toEqual(["دیوارکوب سبز"]); // "_" is ignored, not a wildcard
    expect(await names("q=" + encodeURIComponent("x'; DROP TABLE products; --"))).toEqual([]);
    expect(await db.product.count()).toBe(4);
  });

  it("filters by category, fulfilment, status, price and availability", async () => {
    expect(await names(`categoryId=${c2}`)).toEqual(["رانر سفارشی", "کوسن بافته"]);
    expect(await names("fulfillment=made_to_order")).toEqual(["رانر سفارشی"]);
    expect(await names("status=published")).toEqual(["دیوارکوب سبز", "رانر سفارشی"]);
    expect(await names("minPrice=1000&maxPrice=2000")).toEqual(["دیوارکوب سبز"]);
    expect(await names("availability=in_stock")).toEqual(["دیوارکوب سبز", "رانر سفارشی"]);
    // variant product with all variants at 0: NULL product inventory must not hide it
    expect(await names("availability=out_of_stock")).toEqual(["کوسن بافته"]);
  });

  it("sorts, paginates and counts", async () => {
    const page1 = await list("sort=name_asc&pageSize=2&page=1");
    const page2 = await list("sort=name_asc&pageSize=2&page=2");
    expect(page1.total).toBe(3);
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(1);
    expect(new Set([...page1.items, ...page2.items].map((i) => i.id)).size).toBe(3);
    expect((await list("sort=price_asc")).items[0]?.name).toBe("کوسن بافته");
    expect((await list("sort=price_desc")).items[0]?.name).toBe("رانر سفارشی");
  });

  it("includes cover image and variant summary in rows", async () => {
    const { items } = await list("q=" + encodeURIComponent("کوسن"));
    expect(items[0]).toMatchObject({ coverKey: null, variantCount: 1, variantAvailableCount: 0, variantMinPriceToman: 500 });
    expect((await list("q=" + encodeURIComponent("دیوارکوب"))).items[0]).toMatchObject({ coverKey: "images/p/a.webp", coverAlt: "تصویر a" });
  });

  it("scales: search and paging stay correct with 1,500 products", async () => {
    const vendor = await db.vendor.findFirstOrThrow();
    await db.product.createMany({
      data: Array.from({ length: 1500 }, (_, i) => ({ vendorId: vendor.id, slug: `bulk-${i}`, name: `محصول انبوه ${i}`, fulfillment: "unique" as const, inventory: 1, searchText: `محصول انبوه ${i}` })),
    });
    const r = await list("q=" + encodeURIComponent("انبوه 1499") + "&pageSize=100");
    expect(r.total).toBe(1);
    expect((await list("q=" + encodeURIComponent("انبوه") + "&pageSize=100&page=15")).items).toHaveLength(100);
  });
});

describe("bulk import", () => {
  it("creates and updates by slug in one transaction", async () => {
    const existing = await service.create(input({ name: "قدیمی", slug: "old", categoryId: c1 }), ACTOR);
    const outcome = await service.importChunk([forImport({ name: "به‌روز", slug: "old", categoryId: c2 }), forImport({ name: "تازه", slug: "fresh" })], ACTOR);
    expect(outcome).toMatchObject({ created: 1, updated: 1 });
    expect(outcome.affected.find((a) => a.id === existing.id)).toEqual({ id: existing.id, previousCategoryId: c1 });
    expect(await repo.getProduct(existing.id)).toMatchObject({ name: "به‌روز", categoryId: c2, version: 2 });
    expect((await db.product.findMany({ orderBy: { slug: "asc" } })).map((p) => p.slug)).toEqual(["fresh", "old"]);
  });

  it("is all-or-nothing when one product conflicts", async () => {
    await service.create(input({ name: "دارنده", fulfillment: "stocked", variants: [{ sku: "TAKEN", options: { s: "1" }, inventory: 1 }] }), ACTOR);
    const bad = [forImport({ name: "نو", slug: "new-one" }), forImport({ name: "تکراری", slug: "dupe", fulfillment: "stocked", variants: [{ sku: "TAKEN", options: { s: "1" }, inventory: 1 }] })];
    await expect(service.importChunk(bad, ACTOR)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.product.count({ where: { slug: { in: ["new-one", "dupe"] } } })).toBe(0);
  });
});

describe("images and categories", () => {
  it("appends images up to the limit", async () => {
    const p = await service.create(input({ name: "با تصویر" }), ACTOR);
    expect(await repo.addImage(p.id, "images/p/1.webp", "یک", 2, ACTOR)).toBe(true);
    expect(await repo.addImage(p.id, "images/p/2.webp", "دو", 2, ACTOR)).toBe(true);
    expect(await repo.addImage(p.id, "images/p/3.webp", "سه", 2, ACTOR)).toBe(false);
    expect((await repo.getProduct(p.id))?.images.map((i) => [i.key, i.position])).toEqual([["images/p/1.webp", 0], ["images/p/2.webp", 1]]);
    await expect(repo.addImage("missing", "images/p/x.webp", "", 2, ACTOR)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("never exceeds the image limit under concurrent uploads", async () => {
    const p = await service.create(input({ name: "همزمان" }), ACTOR);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => repo.addImage(p.id, `images/p/c${i}.webp`, "", 3, ACTOR)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect((await repo.getProduct(p.id))?.images).toHaveLength(3);
  });

  it("creates categories, rejects duplicate slugs, counts published products", async () => {
    const wood = await repo.createCategory({ slug: "wood", name: "چوبی" });
    expect(wood.position).toBeGreaterThan(0);
    await expect(repo.createCategory({ slug: "wood", name: "دیگر" })).rejects.toMatchObject({ code: "category_slug_taken" });
    await expect(repo.createCategory({ slug: "orphan", name: "یتیم", parentId: "nope" })).rejects.toBeInstanceOf(ValidationError);
    const p = await service.create(input({ name: "منتشرشده", categoryId: c1, priceToman: 1, images: [img("a")], status: "published" }), ACTOR);
    const counts = await repo.listCategoryCounts();
    expect(counts.find((x) => x.id === c1)?.publishedCount).toBe(1);
    expect(counts.find((x) => x.id === c2)?.publishedCount).toBe(0);
    expect((await repo.listPublishedRows(c1, 10)).map((r) => r.id)).toEqual([p.id]);
  });
});

describe("database safety net", () => {
  it("rejects invalid data even if application validation is bypassed", async () => {
    const vendor = await db.vendor.findFirstOrThrow();
    const base = { vendorId: vendor.id, name: "x", searchText: "x" };
    await expect(db.product.create({ data: { ...base, slug: "a1", fulfillment: "made_to_order", inventory: 3 } })).rejects.toThrow();
    await expect(db.product.create({ data: { ...base, slug: "a2", fulfillment: "unique", inventory: 5 } })).rejects.toThrow();
    await expect(db.product.create({ data: { ...base, slug: "a3", fulfillment: "stocked", inventory: 1, priceToman: -5 } })).rejects.toThrow();
    await expect(db.product.create({ data: { ...base, slug: "a4", fulfillment: "stocked", inventory: -1 } })).rejects.toThrow();
    expect(await db.product.count()).toBe(0);
  });

  it("stores prices as BIGINT and refuses amounts beyond the supported range even without the application", async () => {
    const columns = await db.$queryRawUnsafe<Array<{ table_name: string; data_type: string }>>(
      `SELECT table_name, data_type FROM information_schema.columns WHERE column_name = 'priceToman' AND table_schema = '${testDb.schema}'`,
    );
    // sorted here, not in SQL: ORDER BY follows the server's collation, which differs between PostgreSQL installations
    expect(columns.sort((a, b) => (a.table_name < b.table_name ? -1 : 1))).toEqual([
      { table_name: "product_variants", data_type: "bigint" },
      { table_name: "products", data_type: "bigint" },
    ]);
    const vendor = await db.vendor.findFirstOrThrow();
    const base = { vendorId: vendor.id, name: "x", searchText: "x", fulfillment: "stocked" as const, inventory: 1 };
    await expect(db.product.create({ data: { ...base, slug: "ok", priceToman: 1_000_000_000_000_000n } })).resolves.toBeTruthy();
    await expect(db.product.create({ data: { ...base, slug: "too-big", priceToman: 1_000_000_000_000_001n } })).rejects.toThrow();
    await expect(db.product.create({ data: { ...base, slug: "huge", priceToman: 9_223_372_036_854_775_807n } })).rejects.toThrow();
  });
});

describe("large prices", () => {
  it("round-trip exactly through create, read, update, import and list", async () => {
    const big = 999_999_999_999_999;
    const p = await service.create(input({ name: "گران قیمت", fulfillment: "stocked", inventory: 1, priceToman: big, variants: undefined }), ACTOR);
    expect(p.priceToman).toBe(big);
    expect((await repo.getProduct(p.id))?.priceToman).toBe(big);
    const updated = await service.update(p.id, input({ name: "گران قیمت", slug: p.slug, fulfillment: "stocked", inventory: 1, priceToman: 1_000_000_000_000_000 }), 1, ACTOR);
    expect(updated.priceToman).toBe(1_000_000_000_000_000);
    await service.importChunk([forImport({ slug: "imp-big", name: "وارد شده", fulfillment: "stocked", inventory: 1, priceToman: 5_000_000_000_000 })], ACTOR);
    const sorted = (await list("sort=price_desc")).items.map((i) => i.priceToman);
    expect(sorted).toEqual([1_000_000_000_000_000, 5_000_000_000_000]);
  });

  it("applies large variant prices to the list summary", async () => {
    await service.create(input({ name: "تنوع گران", fulfillment: "stocked", priceToman: 7_000_000_000_000, variants: [{ sku: "B1", options: { s: "1" }, inventory: 1, priceToman: 3_000_000_000_000 }, { sku: "B2", options: { s: "2" }, inventory: 1 }] }), ACTOR);
    const row = (await list("")).items[0];
    expect(row).toMatchObject({ priceToman: 7_000_000_000_000, variantMinPriceToman: 3_000_000_000_000 });
  });
});

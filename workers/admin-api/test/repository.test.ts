import { beforeEach, describe, expect, it } from "vitest";
import { parseProductListQuery } from "../../../src/domain/product/query";
import { validateProductInput, type ProductInput } from "../../../src/domain/product/schema";
import type { D1DatabaseLike } from "../src/d1";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  addImageRow,
  createCategory,
  createProduct,
  getAdmin,
  getProduct,
  importProducts,
  listCategoriesWithCounts,
  listProducts,
  listPublishedRows,
  setProductStatus,
  updateProduct,
  type Deps,
} from "../src/repository";
import { createTestDb, seedAdmin, seedCategory, sql } from "./d1-shim";

let counter = 0;
const deps: Deps = { now: () => `2026-03-01T00:00:${String(counter % 60).padStart(2, "0")}.000Z`, uuid: () => `id-${++counter}` };
const ACTOR = "owner@example.test";

function input(raw: Record<string, unknown>): ProductInput & { slug: string } {
  const r = validateProductInput({ fulfillment: "unique", ...raw });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return { ...r.value, slug: r.value.slug ?? "" };
}
const img = (n: string) => ({ key: `images/p/${n}.webp`, alt: `تصویر ${n}` });
const list = async (db: D1DatabaseLike, qs = "") => {
  const q = parseProductListQuery(new URLSearchParams(qs));
  if (!q.ok) throw new Error("bad query");
  return listProducts(db, q.value);
};

let db: D1DatabaseLike;
beforeEach(async () => {
  counter = 0;
  db = createTestDb();
  await seedCategory(db, "c1", "wall-hangings", "دیوارکوب بافته");
  await seedCategory(db, "c2", "home-decor", "دکور خانه");
});

describe("createProduct / getProduct", () => {
  it("stores a unique product with images and returns it", async () => {
    const created = await createProduct(db, input({ name: "دیوارکوب نمونه", description: "توضیح", categoryId: "c1", priceToman: 1500000, images: [img("a"), img("b")] }), ACTOR, deps);
    expect(created).toMatchObject({ slug: "دیوارکوب-نمونه", status: "draft", fulfillment: "unique", inventory: 1, priceToman: 1500000, version: 1, publishedAt: null });
    expect(created.images.map((i) => i.key)).toEqual(["images/p/a.webp", "images/p/b.webp"]);
    expect(await getProduct(db, created.id)).toEqual(created);
  });

  it("stores variants for stocked and made-to-order products", async () => {
    const stocked = await createProduct(db, input({ name: "کوسن نمونه", fulfillment: "stocked", priceToman: 500, variants: [{ sku: "K-S", options: { size: "S" }, inventory: 2 }, { sku: "K-L", options: { size: "L" }, inventory: 0, priceToman: 700 }] }), ACTOR, deps);
    expect(stocked.variants).toHaveLength(2);
    expect(stocked.variants[1]).toMatchObject({ sku: "K-L", priceToman: 700, inventory: 0, options: { size: "L" } });
    const mto = await createProduct(db, input({ name: "رانر سفارشی", fulfillment: "made_to_order", leadTimeDays: 21 }), ACTOR, deps);
    expect(mto).toMatchObject({ fulfillment: "made_to_order", leadTimeDays: 21, inventory: null });
  });

  it("makes generated slugs unique but reports explicit slug clashes", async () => {
    const a = await createProduct(db, input({ name: "ماکرومه نمونه" }), ACTOR, deps);
    const b = await createProduct(db, input({ name: "ماکرومه نمونه" }), ACTOR, deps);
    expect(b.slug).toBe(`${a.slug}-2`);
    await expect(createProduct(db, input({ name: "دیگر", slug: a.slug }), ACTOR, deps)).rejects.toMatchObject({ code: "slug_taken" });
  });

  it("rejects duplicate SKUs across products and rolls back everything", async () => {
    const variant = { sku: "DUP", options: { size: "S" }, inventory: 1 };
    await createProduct(db, input({ name: "نخست", fulfillment: "stocked", variants: [variant] }), ACTOR, deps);
    await expect(createProduct(db, input({ name: "دوم", fulfillment: "stocked", variants: [variant] }), ACTOR, deps)).rejects.toMatchObject({ code: "sku_taken" });
    expect(await sql(db, "SELECT id FROM products")).toHaveLength(1);
    expect(await sql(db, "SELECT id FROM audit_log")).toHaveLength(1);
  });

  it("returns null for unknown ids and writes an audit entry", async () => {
    expect(await getProduct(db, "missing")).toBeNull();
    await createProduct(db, input({ name: "با ثبت رخداد" }), ACTOR, deps);
    expect(await sql(db, "SELECT actor_email, action FROM audit_log")).toEqual([{ actor_email: ACTOR, action: "product.create" }]);
  });
});

describe("updateProduct (optimistic concurrency)", () => {
  it("replaces fields and children and bumps the version", async () => {
    const p = await createProduct(db, input({ name: "نخست", images: [img("a")] }), ACTOR, deps);
    const updated = await updateProduct(db, p.id, input({ name: "ویرایش‌شده", slug: p.slug, images: [img("b"), img("c")], priceToman: 900 }), 1, ACTOR, deps);
    expect(updated).toMatchObject({ name: "ویرایش‌شده", version: 2, priceToman: 900 });
    expect(updated.images.map((i) => i.key)).toEqual(["images/p/b.webp", "images/p/c.webp"]);
  });

  it("rejects a stale version without touching children", async () => {
    const p = await createProduct(db, input({ name: "نخست", images: [img("a")] }), ACTOR, deps);
    await updateProduct(db, p.id, input({ name: "دوم", slug: p.slug, images: [img("a")] }), 1, ACTOR, deps);
    await expect(updateProduct(db, p.id, input({ name: "کهنه", slug: p.slug, images: [img("x"), img("y")] }), 1, ACTOR, deps)).rejects.toMatchObject({ code: "version_conflict" });
    const after = await getProduct(db, p.id);
    expect(after).toMatchObject({ name: "دوم", version: 2 });
    expect(after?.images.map((i) => i.key)).toEqual(["images/p/a.webp"]);
    expect(await sql(db, "SELECT action FROM audit_log WHERE action = 'product.update'")).toHaveLength(1);
  });

  it("reports unknown products and SKU clashes (rolled back)", async () => {
    await expect(updateProduct(db, "nope", input({ name: "ناموجود" }), 1, ACTOR, deps)).rejects.toBeInstanceOf(NotFoundError);
    await createProduct(db, input({ name: "الف الف", fulfillment: "stocked", variants: [{ sku: "SKU-1", options: { s: "1" }, inventory: 1 }] }), ACTOR, deps);
    const b = await createProduct(db, input({ name: "ب ب", fulfillment: "stocked", inventory: 1 }), ACTOR, deps);
    await expect(updateProduct(db, b.id, input({ name: "ب ب", slug: b.slug, fulfillment: "stocked", variants: [{ sku: "SKU-1", options: { s: "1" }, inventory: 1 }] }), 1, ACTOR, deps)).rejects.toMatchObject({ code: "sku_taken" });
    expect(await getProduct(db, b.id)).toMatchObject({ version: 1, variants: [] });
  });
});

describe("setProductStatus", () => {
  it("publishes a complete product and stamps publishedAt once", async () => {
    const p = await createProduct(db, input({ name: "کامل", categoryId: "c1", priceToman: 100, images: [img("a")] }), ACTOR, deps);
    const published = await setProductStatus(db, p.id, "published", 1, ACTOR, deps);
    expect(published).toMatchObject({ status: "published", version: 2 });
    expect(published.publishedAt).toBeTruthy();
    const archived = await setProductStatus(db, p.id, "archived", 2, ACTOR, deps);
    expect(archived).toMatchObject({ status: "archived", publishedAt: published.publishedAt });
  });

  it("refuses to publish an incomplete product with Persian-mappable codes", async () => {
    const p = await createProduct(db, input({ name: "ناقص" }), ACTOR, deps);
    const error = await setProductStatus(db, p.id, "published", 1, ACTOR, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues.map((i) => i.code)).toEqual(expect.arrayContaining(["category_required_to_publish", "image_required_to_publish", "price_required_to_publish"]));
    expect(await getProduct(db, p.id)).toMatchObject({ status: "draft", version: 1 });
  });
});

describe("listProducts: search and filters", () => {
  beforeEach(async () => {
    await createProduct(db, input({ name: "دیوارکوب سبز", description: "بافته با نخ پنبه", categoryId: "c1", priceToman: 1000, status: "published", images: [img("a")] }), ACTOR, deps);
    await createProduct(db, input({ name: "کوسن بافته", fulfillment: "stocked", categoryId: "c2", priceToman: 500, status: "draft", variants: [{ sku: "CUSH-1", options: { size: "S" }, inventory: 0 }] }), ACTOR, deps);
    await createProduct(db, input({ name: "رانر سفارشی", fulfillment: "made_to_order", leadTimeDays: 14, categoryId: "c2", priceToman: 3000, status: "published", images: [img("b")] }), ACTOR, deps);
    await createProduct(db, input({ name: "بایگانی‌شده", status: "archived" }), ACTOR, deps);
  });
  const names = async (qs: string) => (await list(db, qs)).items.map((i) => i.name).sort();

  it("hides archived by default and shows them on request", async () => {
    expect(await names("")).toEqual(["دیوارکوب سبز", "رانر سفارشی", "کوسن بافته"]);
    expect(await names("status=archived")).toEqual(["بایگانی‌شده"]);
  });

  it("searches Persian text regardless of Arabic letters, digits or ZWNJ", async () => {
    expect(await names("q=ديوار")).toEqual(["دیوارکوب سبز"]);
    expect(await names("q=" + encodeURIComponent("بافته"))).toEqual(["دیوارکوب سبز", "کوسن بافته"]);
    expect(await names("q=CUSH-1")).toEqual(["کوسن بافته"]);
    expect(await names("q=" + encodeURIComponent("سبز بافته"))).toEqual(["دیوارکوب سبز"]);
    expect(await names("q=" + encodeURIComponent("100%"))).toEqual([]);
  });

  it("filters by category, fulfilment, status, price and availability", async () => {
    expect(await names("categoryId=c2")).toEqual(["رانر سفارشی", "کوسن بافته"]);
    expect(await names("fulfillment=made_to_order")).toEqual(["رانر سفارشی"]);
    expect(await names("status=published")).toEqual(["دیوارکوب سبز", "رانر سفارشی"]);
    expect(await names("minPrice=1000&maxPrice=2000")).toEqual(["دیوارکوب سبز"]);
    expect(await names("availability=in_stock")).toEqual(["دیوارکوب سبز", "رانر سفارشی"]);
    expect(await names("availability=out_of_stock")).toEqual(["کوسن بافته"]);
  });

  it("sorts, paginates and counts", async () => {
    const page1 = await list(db, "sort=name_asc&pageSize=2&page=1");
    const page2 = await list(db, "sort=name_asc&pageSize=2&page=2");
    expect(page1.total).toBe(3);
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(1);
    expect(new Set([...page1.items, ...page2.items].map((i) => i.id)).size).toBe(3);
    const cheap = await list(db, "sort=price_asc");
    expect(cheap.items[0]?.name).toBe("کوسن بافته");
  });

  it("includes cover image and variant summary in rows", async () => {
    const { items } = await list(db, "q=" + encodeURIComponent("کوسن"));
    expect(items[0]).toMatchObject({ coverKey: null, variantCount: 1, variantAvailableCount: 0 });
    const withCover = (await list(db, "q=" + encodeURIComponent("دیوارکوب"))).items[0];
    expect(withCover).toMatchObject({ coverKey: "images/p/a.webp", coverAlt: "تصویر a" });
  });

  it("scales: search and paging stay correct with 1,500 products", async () => {
    const statements = Array.from({ length: 1500 }, (_, i) =>
      db.prepare("INSERT INTO products (id, slug, name, fulfillment, inventory, search_text, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(`bulk-${i}`, `bulk-${i}`, `محصول انبوه ${i}`, "unique", 1, `محصول انبوه ${i}`, "2026-01-01", "2026-01-01"),
    );
    await db.batch(statements);
    const r = await list(db, "q=" + encodeURIComponent("انبوه 1499") + "&pageSize=100");
    expect(r.total).toBe(1);
    expect((await list(db, "q=" + encodeURIComponent("انبوه") + "&pageSize=100&page=15")).items).toHaveLength(100);
  });
});

describe("importProducts", () => {
  it("creates and updates by slug in one transaction", async () => {
    const existing = await createProduct(db, input({ name: "قدیمی", slug: "old", categoryId: "c1" }), ACTOR, deps);
    const outcome = await importProducts(db, [input({ name: "به‌روز", slug: "old", categoryId: "c2" }), input({ name: "تازه", slug: "fresh" })], ACTOR, deps);
    expect(outcome).toMatchObject({ created: 1, updated: 1 });
    expect(outcome.affected.find((a) => a.id === existing.id)).toEqual({ id: existing.id, previousCategoryId: "c1" });
    expect(await getProduct(db, existing.id)).toMatchObject({ name: "به‌روز", categoryId: "c2", version: 2 });
    expect(await sql(db, "SELECT slug FROM products ORDER BY slug")).toEqual([{ slug: "fresh" }, { slug: "old" }]);
  });

  it("is all-or-nothing when one product conflicts", async () => {
    await createProduct(db, input({ name: "دارنده", fulfillment: "stocked", variants: [{ sku: "TAKEN", options: { s: "1" }, inventory: 1 }] }), ACTOR, deps);
    const bad = [input({ name: "نو", slug: "new-one" }), input({ name: "تکراری", slug: "dupe", fulfillment: "stocked", variants: [{ sku: "TAKEN", options: { s: "1" }, inventory: 1 }] })];
    await expect(importProducts(db, bad, ACTOR, deps)).rejects.toBeInstanceOf(ConflictError);
    expect(await sql(db, "SELECT slug FROM products WHERE slug IN ('new-one','dupe')")).toEqual([]);
  });
});

describe("images, categories, admins", () => {
  it("appends images up to the limit", async () => {
    const p = await createProduct(db, input({ name: "با تصویر" }), ACTOR, deps);
    expect(await addImageRow(db, p.id, "images/p/1.webp", "یک", 2, ACTOR, deps)).toBe(true);
    expect(await addImageRow(db, p.id, "images/p/2.webp", "دو", 2, ACTOR, deps)).toBe(true);
    expect(await addImageRow(db, p.id, "images/p/3.webp", "سه", 2, ACTOR, deps)).toBe(false);
    expect((await getProduct(db, p.id))?.images.map((i) => [i.key, i.position])).toEqual([["images/p/1.webp", 0], ["images/p/2.webp", 1]]);
  });

  it("creates categories, rejects duplicate slugs, counts published products", async () => {
    const c = await createCategory(db, { slug: "wood", name: "كيف چوبی" }, deps);
    expect(c.name).toBe("کیف چوبی");
    await expect(createCategory(db, { slug: "wood", name: "دیگر" }, deps)).rejects.toMatchObject({ code: "category_slug_taken" });
    const p = await createProduct(db, input({ name: "منتشرشده", categoryId: "c1", priceToman: 1, images: [img("a")], status: "published" }), ACTOR, deps);
    const counts = await listCategoriesWithCounts(db);
    expect(counts.find((x) => x.id === "c1")?.count).toBe(1);
    expect(counts.find((x) => x.id === "c2")?.count).toBe(0);
    expect((await listPublishedRows(db, "c1")).map((r) => r.id)).toEqual([p.id]);
  });

  it("only returns enabled admins, matching email case-insensitively", async () => {
    await seedAdmin(db, "boss@example.test", "owner");
    await seedAdmin(db, "gone@example.test", "editor", 1);
    expect(await getAdmin(db, "BOSS@Example.test")).toEqual({ email: "boss@example.test", role: "owner" });
    expect(await getAdmin(db, "gone@example.test")).toBeNull();
    expect(await getAdmin(db, "nobody@example.test")).toBeNull();
  });
});

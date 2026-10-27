import { describe, expect, it } from "vitest";
import { buildCatalogSeo } from "./catalog-seo";
import { loadSnapshotCatalog } from "./catalog-source";
import { catalog, product } from "./fixtures";

const LIVE = { origin: "https://jaryan.example.ir", indexing: true };
const seoOf = (products: ReturnType<typeof product>[]) => buildCatalogSeo(catalog(products), LIVE, "جریان ما");

describe("editor-chosen SEO text", () => {
  it("wins over the generated title and description", () => {
    const p = product({ seoTitle: "دیوارکوب پاییزی دست‌بافت", seoDescription: "توضیح انتخاب‌شده توسط ویراستار برای نتایج جست‌وجو." });
    const s = seoOf([p]).products.get(p.slug)!;
    expect(s.title).toBe("دیوارکوب پاییزی دست‌بافت");
    expect(s.description).toBe("توضیح انتخاب‌شده توسط ویراستار برای نتایج جست‌وجو.");
  });

  it("falls back to generated text when blank, and the two can be mixed", () => {
    const p = product({ seoTitle: "  ", seoDescription: "فقط توضیح سفارشی" });
    const s = seoOf([p]).products.get(p.slug)!;
    expect(s.title).toBe("دیوارکوب بافته پاییزی");
    expect(s.description).toBe("فقط توضیح سفارشی");
  });

  it("is cleaned and limited like any other text (no markup, bounded length)", () => {
    const p = product({ seoTitle: "<b>عنوان</b> " + "ا".repeat(200), seoDescription: "<script>x</script>" + "ب".repeat(500) });
    const s = seoOf([p]).products.get(p.slug)!;
    expect(s.title).not.toMatch(/[<>]/);
    expect(s.title.length).toBeLessThanOrEqual(70);
    expect(s.description).not.toMatch(/[<>]/);
    expect(s.description.length).toBeLessThanOrEqual(160);
  });

  it("titles and descriptions stay unique even when two products get the same override", () => {
    const a = product({ slug: "a-1", name: "اثر یک", seoTitle: "عنوان یکسان", seoDescription: "توضیح یکسان" });
    const b = product({ slug: "b-1", name: "اثر دو", seoTitle: "عنوان یکسان", seoDescription: "توضیح یکسان" });
    const s = seoOf([a, b]);
    expect(s.products.get("a-1")!.title).not.toBe(s.products.get("b-1")!.title);
    expect(s.products.get("a-1")!.description).not.toBe(s.products.get("b-1")!.description);
  });
});

describe("snapshot files written before these fields existed", () => {
  it("load fine and simply have no override", async () => {
    const files: Record<string, unknown> = {
      "catalog/manifest.json": { version: 1, categories: [{ slug: "c", name: "دسته", count: 1, shard: "x" }] },
      "catalog/categories/c.json": { products: [{ slug: "a-1" }] },
      "catalog/products/a-1.json": { slug: "a-1", name: "اثر", description: "", category: { slug: "c", name: "دسته" }, fulfillment: "unique", priceToman: 1000, availability: "in_stock", leadTimeDays: null, images: [], variants: [] },
    };
    const loaded = await loadSnapshotCatalog({ readText: async (path) => (path in files ? JSON.stringify(files[path]) : null) });
    expect(loaded.products[0]).toMatchObject({ seoTitle: null, seoDescription: null });
  });
});

import { describe, expect, it } from "vitest";
import { buildCatalogSeo, relatedProducts } from "./catalog-seo";
import { catalog, product } from "./fixtures";
import { categoryCollectionJsonLd } from "./jsonld";
import { parseOverrides } from "./overrides-file";
import { buildRobots, PRIVATE_PATHS } from "./sitemap";

const LIVE = { origin: "https://jaryan.example.ir", indexing: true };
const build = (products: ReturnType<typeof product>[], overrides?: ReturnType<typeof parseOverrides>, source: "snapshot" | "demo" = "snapshot") =>
  buildCatalogSeo(catalog(products, source), LIVE, "جریان ما", overrides);

describe("approved overrides (seo/overrides.json)", () => {
  const entry = (slug: string, e: object) => parseOverrides(JSON.stringify({ version: 1, products: { [slug]: e } }));

  it("replace the generated text, but never an editor's own SEO text", () => {
    const o = entry("a", { title: "عنوان تأییدشده برای صفحه", description: "توضیح تأییدشده که از اطلاعات واقعی محصول ساخته شده است." });
    const plain = build([product({ slug: "a" })], o).products.get("a")!;
    expect(plain.title).toBe("عنوان تأییدشده برای صفحه");
    expect(plain.description).toBe("توضیح تأییدشده که از اطلاعات واقعی محصول ساخته شده است.");
    const edited = build([product({ slug: "a", seoTitle: "عنوان ویراستار", seoDescription: "توضیح ویراستار که باید برنده شود در هر شرایطی." })], o).products.get("a")!;
    expect(edited.title).toBe("عنوان ویراستار");
    expect(edited.description).toBe("توضیح ویراستار که باید برنده شود در هر شرایطی.");
  });

  it("an entry for an unknown product is ignored, and an empty file changes nothing", () => {
    const o = entry("nope", { title: "عنوان بدون محصول" });
    expect(build([product({ slug: "a" })], o).products.get("a")!.title).toBe("دیوارکوب بافته پاییزی");
    expect(build([product({ slug: "a" })], parseOverrides('{"version":1,"products":{}}')).products.get("a")!.title).toBe("دیوارکوب بافته پاییزی");
  });

  it("two entries with the same text still produce unique titles", () => {
    const o = parseOverrides(JSON.stringify({ version: 1, products: { a: { title: "عنوان یکسان برای دو صفحه" }, b: { title: "عنوان یکسان برای دو صفحه" } } }));
    const s = build([product({ slug: "a", name: "اثر یک" }), product({ slug: "b", name: "اثر دو" })], o);
    expect(s.products.get("a")!.title).not.toBe(s.products.get("b")!.title);
  });

  it("a broken file is an error (the build fails instead of silently dropping an approved change)", () => {
    for (const bad of ['{"version":2,"products":{}}', '{"version":1,"products":{"a":{}}}', '{"version":1,"products":{"a":{"title":"x"}}}', '{"version":1,"products":{"a":{"title":"عنوان درست است","extra":1}}}', '{"version":1,"products":{"a":{"description":"کوتاه"}}}', "not json"]) {
      expect(() => parseOverrides(bad), bad).toThrow();
    }
  });

  it("is cleaned like any other text", () => {
    const o = entry("a", { title: "<b>عنوان</b> با   فاصله‌های زیاد" });
    expect(build([product({ slug: "a" })], o).products.get("a")!.title).toBe("عنوان با فاصله‌های زیاد");
  });
});

describe("robots.txt after launch", () => {
  it("allows the site, closes the private shopping pages and the API, and never blocks real product pages", () => {
    const r = buildRobots("https://jaryan.example.ir", true);
    const rules = Array.isArray(r.rules) ? r.rules[0]! : r.rules;
    expect(rules.disallow).toEqual(PRIVATE_PATHS);
    expect(PRIVATE_PATHS).toEqual(expect.arrayContaining(["/cart", "/checkout", "/order", "/orders", "/product?", "/api/"]));
    expect(PRIVATE_PATHS.some((p) => "/products/x".startsWith(p))).toBe(false); // `/product?` does not match `/products/…`
    expect(PRIVATE_PATHS.some((p) => "/category/x".startsWith(p))).toBe(false);
    expect(r.sitemap).toBe("https://jaryan.example.ir/sitemap.xml");
  });
  it("is fully closed before launch", () => {
    expect(buildRobots("https://jaryan.example.ir", false)).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    expect(buildRobots(null, true)).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});

describe("category collection data", () => {
  it("lists the indexable products in order with their canonical URLs", () => {
    const seo = build([product({ slug: "b", name: "ب ب" }), product({ slug: "a", name: "ا ا" })]);
    const ld = categoryCollectionJsonLd("دیوارکوب", seo) as { mainEntity: { numberOfItems: number; itemListElement: Array<{ position: number; url: string }> } };
    expect(ld.mainEntity.numberOfItems).toBe(2);
    expect(ld.mainEntity.itemListElement.map((i) => [i.position, i.url])).toEqual([[1, "https://jaryan.example.ir/products/a"], [2, "https://jaryan.example.ir/products/b"]]);
  });
  it("is absent for sample content, a closed site or an unknown category", () => {
    expect(categoryCollectionJsonLd("دیوارکوب", build([product({ isDemo: true })], undefined, "demo"))).toBeNull();
    expect(categoryCollectionJsonLd("x", build([product()]))).toBeNull();
    const closed = buildCatalogSeo(catalog([product()]), { origin: "https://jaryan.example.ir", indexing: false }, "جریان ما");
    expect(categoryCollectionJsonLd("دیوارکوب", closed)).toBeNull();
  });
});

describe("related products (internal links)", () => {
  const cat = { slug: "c", name: "دسته" };
  const mk = (slug: string, over: object = {}) => product({ slug, name: slug, category: cat, ...over });
  it("same category only, purchasable before sold out, stable order, never itself, capped", () => {
    const all = [mk("a"), mk("b", { availability: "sold_out" }), mk("c1"), mk("d"), mk("e"), mk("f"), mk("other", { category: { slug: "x", name: "ایکس" } })];
    const rel = relatedProducts(catalog(all), all[0]!, 4).map((p) => p.slug);
    expect(rel).toEqual(["c1", "d", "e", "f"]);
    expect(rel).not.toContain("a");
    expect(relatedProducts(catalog(all), all[0]!, 10).map((p) => p.slug)).toEqual(["c1", "d", "e", "f", "b"]);
  });
  it("a sold-out page links to purchasable alternatives", () => {
    const all = [mk("gone", { availability: "sold_out" }), mk("here")];
    expect(relatedProducts(catalog(all), all[0]!).map((p) => p.slug)).toEqual(["here"]);
  });
  it("none without a category, and sample content never mixes with real products", () => {
    expect(relatedProducts(catalog([mk("a", { category: null })]), mk("a", { category: null }))).toEqual([]);
    const all = [mk("real"), mk("demo-1", { isDemo: true })];
    expect(relatedProducts(catalog(all), all[0]!)).toEqual([]);
  });
});

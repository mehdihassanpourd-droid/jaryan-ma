import { describe, expect, it } from "vitest";
import { buildCatalogSeo, imageAlt } from "./catalog-seo";
import { effectiveSettings, seoSettings, resolveOrigin, type SeoSettings } from "./config";
import { breadcrumbJsonLd, categoryBreadcrumbJsonLd, productJsonLd, serializeJsonLd, siteJsonLd, tomanToRialString } from "./jsonld";
import { buildRobots, buildSitemap, PRIVATE_PATHS } from "./sitemap";
import { cleanText, truncate } from "./text";
import { absoluteImageUrl, categoryPath, decodeParam, isValidSlug, productPath } from "./urls";
import { catalog, product } from "./fixtures";

const ORIGIN = "https://jaryan.example.ir";
const LIVE: SeoSettings = { origin: ORIGIN, indexing: true };
const CLOSED: SeoSettings = { origin: ORIGIN, indexing: false };
const build = (products = [product()], settings: SeoSettings = LIVE) => buildCatalogSeo(catalog(products), settings, "جریان ما");

describe("settings", () => {
  it("accepts a real origin and strips path and trailing slash", () => {
    expect(resolveOrigin("https://jaryan.example.ir/some/path/", true)).toBe(ORIGIN);
  });

  it("never guesses in production: missing, invalid or local addresses give no origin", () => {
    for (const bad of [undefined, "", "not a url", "ftp://x.ir", "http://localhost:3000", "http://127.0.0.1:3000", "https://box.local"]) {
      expect(resolveOrigin(bad, true), String(bad)).toBeNull();
    }
    expect(resolveOrigin("http://localhost:3000", false)).toBe("http://localhost:3000");
  });

  it("indexing needs BOTH the explicit switch and a known origin", () => {
    const env = { NODE_ENV: "production", NEXT_PUBLIC_SITE_URL: ORIGIN };
    expect(seoSettings(env)).toEqual({ origin: ORIGIN, indexing: false });
    expect(seoSettings({ ...env, SEO_ALLOW_INDEXING: "true" })).toEqual({ origin: ORIGIN, indexing: true });
    expect(seoSettings({ ...env, SEO_ALLOW_INDEXING: "yes" }).indexing).toBe(false);
    expect(seoSettings({ NODE_ENV: "production", SEO_ALLOW_INDEXING: "true" })).toEqual({ origin: null, indexing: false });
  });
});

describe("Persian URLs", () => {
  it("keeps Persian slugs and percent-encodes them for URLs", () => {
    expect(isValidSlug("دیوارکوب-بافته-پاییزی")).toBe(true);
    expect(isValidSlug("macrame-2")).toBe(true);
    for (const bad of ["", "a b", "a/b", "-a", "a--b", "../x", "a?b", "<script>"]) expect(isValidSlug(bad), bad).toBe(false);
    expect(productPath("ماکرومه-قوسی")).toBe("/products/%D9%85%D8%A7%DA%A9%D8%B1%D9%88%D9%85%D9%87-%D9%82%D9%88%D8%B3%DB%8C");
    expect(categoryPath("دیوارکوب")).toMatch(/^\/category\/%D8/);
  });

  it("decodes route params whether or not they arrive encoded", () => {
    expect(decodeParam("%D9%85%D8%A7")).toBe("ما");
    expect(decodeParam("ما")).toBe("ما");
    expect(decodeParam("%E0%A4%A")).toBe("%E0%A4%A"); // malformed: left as is, never throws
  });

  it("makes image URLs absolute only when it is safe", () => {
    expect(absoluteImageUrl(ORIGIN, "/media/a.webp")).toBe(`${ORIGIN}/media/a.webp`);
    expect(absoluteImageUrl(null, "/media/a.webp")).toBeNull();
    expect(absoluteImageUrl(ORIGIN, "https://cdn.example.ir/a.webp")).toBe("https://cdn.example.ir/a.webp");
    expect(absoluteImageUrl(ORIGIN, "javascript:alert(1)")).toBeNull();
  });
});

describe("text helpers", () => {
  it("cleans markup and control characters", () => {
    expect(cleanText("  <b>سلام</b>\n\n دنیا‮\t! ")).toBe("سلام دنیا !");
  });

  it("truncates at a word boundary within the limit", () => {
    const text = "کلمه ".repeat(60).trim();
    const t = truncate(text, 100);
    expect(t.length).toBeLessThanOrEqual(100);
    expect(t.endsWith("…")).toBe(true);
    expect(t).not.toMatch(/ …$/);
    expect(truncate("کوتاه", 100)).toBe("کوتاه");
  });
});

describe("titles and descriptions", () => {
  it("builds the title from the product name and category, never from invented words", () => {
    const seo = build().products.get("دیوارکوب-بافته-پاییزی")!;
    expect(seo.title).toBe("دیوارکوب بافته پاییزی");
    const other = build([product({ slug: "a-1", name: "اثر آبی", category: { slug: "x", name: "ماکرومه" } })]).products.get("a-1")!;
    expect(other.title).toBe("اثر آبی – ماکرومه");
  });

  it("uses the product's own description when it is substantial", () => {
    const description = "این دیوارکوب با نخ پنبه‌ای بافته شده و در اتاق نشیمن، رنگ‌های گرم پاییزی را به دیوار می‌آورد و بافتی نرم دارد.";
    const seo = build([product({ description })]).products.get("دیوارکوب-بافته-پاییزی")!;
    expect(seo.description).toContain("نخ پنبه‌ای");
    expect(seo.description.length).toBeLessThanOrEqual(160);
  });

  it("falls back to verified facts only: name, category, availability, lead time and price", () => {
    const d = build([product({ priceToman: 4_500_000 })]).products.get("دیوارکوب-بافته-پاییزی")!.description;
    expect(d).toContain("دیوارکوب بافته پاییزی");
    expect(d).toContain("موجود");
    expect(d).toContain("۴٬۵۰۰٬۰۰۰ تومان");
    const made = build([product({ slug: "m", availability: "made_to_order", fulfillment: "made_to_order", leadTimeDays: 14, priceToman: null })]).products.get("m")!.description;
    expect(made).toContain("ساخت پس از سفارش (زمان ساخت: ۱۴ روز)");
    expect(made).not.toContain("قیمت"); // no price announced: no price claimed
  });

  it("never states a price, rating, review or material that is not in the data", () => {
    const d = build([product({ priceToman: null, description: "" })]).products.get("دیوارکوب-بافته-پاییزی")!.description;
    expect(d).not.toMatch(/قیمت|تومان|امتیاز|نظر|ارسال رایگان|ضمانت|پنبه|پشم/);
  });

  it("sample products only say they are samples: no availability, price or other claims", () => {
    const d = build([product({ slug: "demo-1", isDemo: true, priceToman: null, availability: "in_stock" })]).products.get("demo-1")!.description;
    expect(d).toContain("محتوای نمونه");
    expect(d).not.toMatch(/موجود|ناموجود|قیمت|تومان|سفارش/);
  });

  it("shows 'from' prices for products with variants at different prices", () => {
    const p = product({
      priceToman: null,
      variants: [
        { sku: "S", options: { size: "S" }, priceToman: 1_000_000, available: true },
        { sku: "L", options: { size: "L" }, priceToman: 2_000_000, available: true },
      ],
    });
    expect(build([p]).products.get(p.slug)!.description).toContain("قیمت از ۱٬۰۰۰٬۰۰۰ تومان");
  });

  it("guarantees unique titles and descriptions across the catalogue", () => {
    const same = { name: "ماکرومه قوسی", description: "", category: { slug: "c", name: "ماکرومه" } };
    const products = ["a", "b", "c", "d"].map((slug) => product({ ...same, slug }));
    const seo = build(products);
    const titles = products.map((p) => seo.products.get(p.slug)!.title);
    const descriptions = products.map((p) => seo.products.get(p.slug)!.description);
    expect(new Set(titles).size).toBe(4);
    expect(new Set(descriptions).size).toBe(4);
    expect(titles[0]).toBe("ماکرومه قوسی"); // the first (by slug) is untouched
    expect(titles[1]).toBe("ماکرومه قوسی (۲)");
    for (const d of descriptions) expect(d.length).toBeLessThanOrEqual(160);
  });

  it("is deterministic regardless of input order", () => {
    const products = ["b", "a", "c"].map((slug) => product({ slug, name: "اثر یکسان", category: null }));
    const one = build(products);
    const two = build([...products].reverse());
    for (const p of products) expect(one.products.get(p.slug)!.title).toBe(two.products.get(p.slug)!.title);
  });
});

describe("image alt text", () => {
  it("keeps the editor's alt text and otherwise derives a factual one from the product name", () => {
    expect(imageAlt("اثر", { url: "u", alt: " نمای نزدیک " }, 0, 3)).toBe("نمای نزدیک");
    expect(imageAlt("اثر", { url: "u", alt: "" }, 1, 3)).toBe("اثر (تصویر ۲ از ۳)");
    expect(imageAlt("اثر", { url: "u", alt: "" }, 0, 1)).toBe("اثر");
  });

  it("every image of every product gets non-empty alt text", () => {
    const p = product({ images: [{ url: "https://m.example.ir/1.webp", alt: "" }, { url: "https://m.example.ir/2.webp", alt: "  " }] });
    for (const img of build([p]).products.get(p.slug)!.images) expect(img.alt.length).toBeGreaterThan(3);
  });
});

describe("indexability", () => {
  const demo = product({ slug: "demo-1", isDemo: true });
  it("only real products are indexable, and only once the site is launched", () => {
    expect(build([product()], LIVE).products.get("دیوارکوب-بافته-پاییزی")!.indexable).toBe(true);
    expect(build([demo], LIVE).products.get("demo-1")!.indexable).toBe(false);
    expect(build([product()], CLOSED).products.get("دیوارکوب-بافته-پاییزی")!.indexable).toBe(false);
    expect(build([product()], { origin: null, indexing: false }).products.get("دیوارکوب-بافته-پاییزی")!.canonical).toBeNull();
  });

  it("canonical URLs are absolute, percent-encoded and self-referencing", () => {
    expect(build().products.get("دیوارکوب-بافته-پاییزی")!.canonical).toBe(`${ORIGIN}/products/${encodeURIComponent("دیوارکوب-بافته-پاییزی")}`);
  });

  it("category pages are indexable only with at least one indexable product", () => {
    expect(build([product()]).categories.get("دیوارکوب")!.indexable).toBe(true);
    expect(build([demo]).categories.size).toBe(1);
    expect(build([{ ...demo, category: { slug: "c", name: "ج" } }]).categories.get("c")!.indexable).toBe(false);
  });
});

describe("product structured data (JSON-LD)", () => {
  const ld = (p = product(), seo = build([p])) => productJsonLd(p, seo);

  it("describes a real product with only verified facts", () => {
    const p = product({ description: "توضیح واقعی اثر که به اندازه کافی بلند است تا به‌عنوان توضیح متا استفاده شود و ثبت شده است." });
    const json = ld(p)!;
    expect(json).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "دیوارکوب بافته پاییزی",
      url: `${ORIGIN}/products/${encodeURIComponent(p.slug)}`,
      category: "دیوارکوب",
      image: ["https://media.example.ir/images/p1/a.webp"],
      offers: { "@type": "Offer", priceCurrency: "IRR", price: "45000000", availability: "https://schema.org/InStock" },
    });
  });

  it("states the price in Rial (1 Toman = 10 Rial) as an exact string, even beyond 2^53", () => {
    expect(tomanToRialString(4_500_000)).toBe("45000000");
    expect(tomanToRialString(1_000_000_000_000_000)).toBe("10000000000000000");
    const big = product({ priceToman: 999_999_999_999_999 });
    expect((ld(big)!.offers as { price: string }).price).toBe("9999999999999990");
  });

  it("emits no offer when no price is announced, and never ratings, reviews, brand or shipping", () => {
    const json = ld(product({ priceToman: null }))!;
    expect(json).not.toHaveProperty("offers");
    for (const key of ["aggregateRating", "review", "brand", "gtin", "mpn", "shippingDetails", "hasMerchantReturnPolicy", "itemCondition", "material", "color"]) {
      expect(json, key).not.toHaveProperty(key);
    }
  });

  it("omits description unless the product has its own", () => {
    expect(ld(product({ description: "" }))).not.toHaveProperty("description");
  });

  it("maps availability, including sold out and made to order", () => {
    const avail = (a: "sold_out" | "made_to_order") => (ld(product({ availability: a }))!.offers as { availability: string }).availability;
    expect(avail("sold_out")).toBe("https://schema.org/OutOfStock");
    expect(avail("made_to_order")).toBe("https://schema.org/MadeToOrder");
  });

  it("uses an aggregate offer for variants priced differently", () => {
    const p = product({
      priceToman: null,
      variants: [
        { sku: "S", options: {}, priceToman: 1_000_000, available: true },
        { sku: "L", options: {}, priceToman: 3_000_000, available: false },
      ],
    });
    expect(ld(p)!.offers).toMatchObject({ "@type": "AggregateOffer", lowPrice: "10000000", highPrice: "30000000", offerCount: 2, priceCurrency: "IRR" });
  });

  it("is never produced for sample content or without a known origin", () => {
    const demo = product({ isDemo: true });
    expect(productJsonLd(demo, build([demo]))).toBeNull();
    expect(breadcrumbJsonLd(demo, build([demo]))).toBeNull();
    const noOrigin = build([product()], { origin: null, indexing: false });
    expect(productJsonLd(product(), noOrigin)).toBeNull();
  });

  it("skips images that have no usable absolute URL", () => {
    const p = product({ images: [{ url: "/media/a.webp", alt: "x" }, { url: "javascript:alert(1)", alt: "y" }] });
    expect(ld(p)!.image).toEqual([`${ORIGIN}/media/a.webp`]);
  });
});

describe("breadcrumb structured data", () => {
  it("lists home, category and product with absolute URLs and positions", () => {
    const p = product();
    expect(breadcrumbJsonLd(p, build([p]))).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "خانه", item: `${ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "دیوارکوب", item: `${ORIGIN}/category/${encodeURIComponent("دیوارکوب")}` },
        { "@type": "ListItem", position: 3, name: p.name, item: `${ORIGIN}/products/${encodeURIComponent(p.slug)}` },
      ],
    });
  });

  it("works for products without a category and for category pages", () => {
    const p = product({ category: null });
    expect((breadcrumbJsonLd(p, build([p]))!.itemListElement as unknown[]).length).toBe(2);
    expect((categoryBreadcrumbJsonLd("دیوارکوب", build())!.itemListElement as unknown[]).length).toBe(2);
    expect(categoryBreadcrumbJsonLd("missing", build())).toBeNull();
  });
});

describe("JSON-LD serialisation is safe inside a <script> tag", () => {
  it("escapes characters that could close the script or inject markup", () => {
    const out = serializeJsonLd({ name: '</script><script>alert(1)</script> & "quote"  ' });
    expect(out).not.toContain("</script>");
    expect(out).not.toMatch(/[<>&]/);
    expect(out).not.toContain(" ");
    expect(JSON.parse(out).name).toBe('</script><script>alert(1)</script> & "quote"  '); // still the same data
  });

  it("describes the organisation only with confirmed facts", () => {
    const [org, web] = siteJsonLd(ORIGIN, "جریان ما", "https://instagram.com/jaryan.ma");
    expect(org).toMatchObject({ "@type": "Organization", name: "جریان ما", sameAs: ["https://instagram.com/jaryan.ma"] });
    expect(org).not.toHaveProperty("telephone");
    expect(org).not.toHaveProperty("address");
    expect(org).not.toHaveProperty("email");
    expect(web).toMatchObject({ "@type": "WebSite", inLanguage: "fa-IR" });
    expect(siteJsonLd(null, "x", "y")).toEqual([]);
  });
});

describe("launching needs a real catalogue", () => {
  it("the launch switch is ignored while only sample content is available", () => {
    expect(effectiveSettings(LIVE, "demo")).toEqual({ origin: ORIGIN, indexing: false });
    expect(effectiveSettings(LIVE, "snapshot")).toEqual(LIVE);
    expect(effectiveSettings(CLOSED, "snapshot")).toEqual(CLOSED);
  });

  it("a sample-only catalogue stays fully closed even with the launch switch on", () => {
    const sampleOnly = buildCatalogSeo(catalog([product({ slug: "demo-1", isDemo: true })], "demo"), LIVE, "جریان ما");
    expect(sampleOnly.settings.indexing).toBe(false);
    expect([...sampleOnly.products.values()].every((p) => !p.indexable)).toBe(true);
    expect([...sampleOnly.categories.values()].every((c) => !c.indexable)).toBe(true);
    expect(buildSitemap(sampleOnly)).toEqual([]);
    expect(buildRobots(sampleOnly.settings.origin, sampleOnly.settings.indexing)).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("even a mislabelled sample-only catalogue cannot open the site (real products need source=snapshot)", () => {
    const seo = buildCatalogSeo(catalog([product()], "demo"), LIVE, "جریان ما");
    expect([...seo.products.values()].some((p) => p.indexable)).toBe(false);
  });
});

describe("sitemap and robots", () => {
  it("lists the home page, categories with indexable products and every real product", () => {
    const products = [product(), product({ slug: "ماکرومه-قوسی", name: "ماکرومه قوسی", category: { slug: "ماکرومه", name: "ماکرومه" } })];
    const urls = buildSitemap(build(products)).map((e) => e.url);
    expect(urls).toEqual(
      [
        `${ORIGIN}/`,
        `${ORIGIN}/category/${encodeURIComponent("دیوارکوب")}`,
        `${ORIGIN}/category/${encodeURIComponent("ماکرومه")}`,
        `${ORIGIN}/products/${encodeURIComponent("دیوارکوب-بافته-پاییزی")}`,
        `${ORIGIN}/products/${encodeURIComponent("ماکرومه-قوسی")}`,
      ].sort(),
    );
  });

  it("never lists sample content, unlaunched pages or invented dates", () => {
    const demo = product({ slug: "demo-1", isDemo: true, category: { slug: "d", name: "نمونه" } });
    expect(buildSitemap(build([demo])).map((e) => e.url)).toEqual([`${ORIGIN}/`]);
    expect(buildSitemap(build([product()], CLOSED))).toEqual([]); // closed: robots disallows everything, so no sitemap URLs
    for (const entry of buildSitemap(build())) {
      expect(entry).not.toHaveProperty("lastModified");
      expect(entry).not.toHaveProperty("priority");
    }
    expect(buildSitemap(build([product()], { origin: null, indexing: false }))).toEqual([]);
  });

  it("has no duplicate URLs", () => {
    const urls = buildSitemap(build([product(), product({ slug: "x-2", name: "اثر دو" })])).map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("robots.txt stays closed until launch, then allows crawling and names the sitemap", () => {
    expect(buildRobots(ORIGIN, false)).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    expect(buildRobots(null, true)).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    expect(buildRobots(ORIGIN, true)).toEqual({ rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS }, sitemap: `${ORIGIN}/sitemap.xml` });
  });
});

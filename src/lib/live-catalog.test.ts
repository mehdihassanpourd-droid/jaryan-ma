import { describe, expect, it } from "vitest";
import { createLiveCatalog, isLiveSlug, liveCatalogBase, livePrice, liveProductHref, LiveCatalogError, safeImageUrl } from "./live-catalog";

const BASE = "https://cdn.example.test/media";
const card = (slug: string, extra: object = {}) => ({ slug, name: `محصول ${slug}`, fulfillment: "unique", priceToman: 1_000_000, priceFromToman: null, availability: "in_stock", cover: { url: `${BASE}/images/p/${slug}.webp`, alt: "تصویر" }, ...extra });
const product = (slug: string, extra: object = {}) => ({ slug, name: "تابلو", description: "توضیح", seoTitle: null, seoDescription: null, category: { slug: "wall", name: "دیواری" }, fulfillment: "stocked", priceToman: 5_000_000, availability: "in_stock", leadTimeDays: null, images: [{ url: `${BASE}/images/p/a.webp`, alt: "الف" }], variants: [], ...extra });

/** A fake object store: path -> JSON (or a status). */
function store(files: Record<string, unknown>, status: Record<string, number> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const path = decodeURIComponent(new URL(String(input)).pathname.replace(/^\/media\//, ""));
    if (path in status) return new Response("", { status: status[path] });
    if (!(path in files)) return new Response("", { status: 404 });
    const body = files[path];
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

describe("liveCatalogBase", () => {
  it("accepts https and loopback http only, never credentials or other schemes", () => {
    expect(liveCatalogBase("https://cdn.example.test/media/")).toBe("https://cdn.example.test/media");
    expect(liveCatalogBase("http://127.0.0.1:3001/media")).toBe("http://127.0.0.1:3001/media");
    expect(liveCatalogBase("http://cdn.example.test/media")).toBeNull();
    expect(liveCatalogBase("https://user:pw@cdn.example.test/media")).toBeNull();
    expect(liveCatalogBase("javascript:alert(1)")).toBeNull();
    expect(liveCatalogBase("")).toBeNull();
    expect(liveCatalogBase(undefined)).toBeNull();
  });
});

describe("safeImageUrl / slugs / links", () => {
  it("lets only http(s) and site-relative images through", () => {
    expect(safeImageUrl("https://x.test/a.webp")).toBe("https://x.test/a.webp");
    expect(safeImageUrl("/a.webp")).toBe("/a.webp");
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl("data:text/html,x")).toBeNull();
  });
  it("validates slugs like the backend and encodes links", () => {
    expect(isLiveSlug("kuhestan-wall-hanging")).toBe(true);
    expect(isLiveSlug("تابلو-کوه")).toBe(true);
    expect(isLiveSlug("../secret")).toBe(false);
    expect(isLiveSlug("a b")).toBe(false);
    expect(liveProductHref("تابلو-کوه")).toBe(`/product?slug=${encodeURIComponent("تابلو-کوه")}`);
  });
});

describe("loadHome", () => {
  it("before anything is published (no manifest) is an empty catalogue, not an error", async () => {
    expect(await createLiveCatalog(BASE, store({})).loadHome()).toEqual({ categories: [], cards: [] });
  });

  it("merges the category shards: each product once, tagged with its categories; empty categories are skipped", async () => {
    const files = {
      "catalog/manifest.json": { version: 1, categories: [{ slug: "wall", name: "دیواری", count: 2 }, { slug: "table", name: "رومیزی", count: 1 }, { slug: "empty", name: "خالی", count: 0 }] },
      "catalog/categories/wall.json": { category: { slug: "wall", name: "دیواری" }, products: [card("a"), card("b")] },
      "catalog/categories/table.json": { products: [card("c")] },
    };
    const home = await createLiveCatalog(BASE, store(files)).loadHome();
    expect(home.categories.map((c) => c.slug)).toEqual(["wall", "table"]);
    expect(home.cards.map((c) => c.slug).sort()).toEqual(["a", "b", "c"]);
    expect(home.cards.find((c) => c.slug === "a")?.categorySlugs).toEqual(["wall"]);
  });

  it("an unreachable store or a malformed file is an error, never a half-rendered catalogue", async () => {
    await expect(createLiveCatalog(BASE, store({}, { "catalog/manifest.json": 500 })).loadHome()).rejects.toMatchObject({ code: "unreachable" });
    await expect(createLiveCatalog(BASE, (async () => { throw new Error("offline"); }) as typeof fetch).loadHome()).rejects.toBeInstanceOf(LiveCatalogError);
    await expect(createLiveCatalog(BASE, store({ "catalog/manifest.json": "not json" })).loadHome()).rejects.toMatchObject({ code: "invalid" });
    const badShard = { "catalog/manifest.json": { version: 1, categories: [{ slug: "wall", name: "د", count: 1 }] }, "catalog/categories/wall.json": { products: [{ slug: "a", name: "x" }] } };
    await expect(createLiveCatalog(BASE, store(badShard)).loadHome()).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("loadProduct", () => {
  it("returns the published product; a missing file (draft, archived, unknown) is null", async () => {
    const files = { "catalog/products/kuhestan.json": product("kuhestan") };
    const live = createLiveCatalog(BASE, store(files));
    expect((await live.loadProduct("kuhestan"))?.name).toBe("تابلو");
    expect(await live.loadProduct("draft-one")).toBeNull();
    // an object store may answer 403 for a key that does not exist
    expect(await createLiveCatalog(BASE, store({}, { "catalog/products/x.json": 403 })).loadProduct("x")).toBeNull();
  });
  it("never fetches for an invalid slug (no path tricks) and rejects a file whose slug does not match", async () => {
    let calls = 0;
    const counting = ((input: RequestInfo | URL) => { calls++; return store({})(input); }) as typeof fetch;
    expect(await createLiveCatalog(BASE, counting).loadProduct("../manifest")).toBeNull();
    expect(calls).toBe(0);
    await expect(createLiveCatalog(BASE, store({ "catalog/products/a.json": product("b") })).loadProduct("a")).rejects.toMatchObject({ code: "invalid" });
  });
  it("keeps exact large prices and variant availability", async () => {
    const big = product("big", { priceToman: 999_999_999_999_999, variants: [{ sku: "S", options: { اندازه: "۵۰" }, priceToman: 999_999_999_999_999, available: false }] });
    const p = await createLiveCatalog(BASE, store({ "catalog/products/big.json": big })).loadProduct("big");
    expect(p?.priceToman).toBe(999_999_999_999_999);
    expect(p?.variants[0]?.available).toBe(false);
  });
});

describe("livePrice", () => {
  it("shows the lowest variant price with 'from' only when prices differ", () => {
    expect(livePrice({ priceToman: 5, variants: [] })).toEqual({ amount: 5, from: false });
    expect(livePrice({ priceToman: 5, variants: [{ sku: "a", options: {}, priceToman: 4, available: true }, { sku: "b", options: {}, priceToman: 6, available: true }] })).toEqual({ amount: 4, from: true });
    expect(livePrice({ priceToman: null, variants: [{ sku: "a", options: {}, priceToman: 4, available: true }] })).toEqual({ amount: 4, from: false });
    expect(livePrice({ priceToman: null, variants: [] })).toEqual({ amount: null, from: false });
  });
});

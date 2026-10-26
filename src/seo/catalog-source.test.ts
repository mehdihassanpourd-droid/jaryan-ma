import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoSeoCatalog, dirReader, httpReader, loadSnapshotCatalog, type LoadReport, type SnapshotReader } from "./catalog-source";

const realProduct = (slug: string, over: Record<string, unknown> = {}) => ({
  slug,
  name: "دیوارکوب بافته",
  description: "توضیح",
  category: { slug: "دیوارکوب", name: "دیوارکوب" },
  fulfillment: "unique",
  priceToman: 4_500_000,
  availability: "in_stock",
  leadTimeDays: null,
  images: [{ url: "https://media.example.ir/images/x.webp", alt: "تصویر" }],
  variants: [],
  ...over,
});

/** Builds a snapshot in memory, in exactly the layout server/catalog/snapshot-publisher.ts writes. */
function memoryReader(files: Record<string, unknown>): SnapshotReader & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async readText(path) {
      reads.push(path);
      return path in files ? JSON.stringify(files[path]) : null;
    },
  };
}

const layout = (slugs: string[], products: Record<string, unknown> = {}) => ({
  "catalog/manifest.json": { version: 3, categories: [{ slug: "دیوارکوب", name: "دیوارکوب", count: slugs.length, shard: "x" }] },
  "catalog/categories/دیوارکوب.json": { category: { slug: "دیوارکوب", name: "دیوارکوب" }, products: slugs.map((slug) => ({ slug, name: "x" })) },
  ...Object.fromEntries(slugs.map((s) => [`catalog/products/${s}.json`, products[s] ?? realProduct(s)])),
});

describe("loading the published snapshot", () => {
  it("reads manifest, category shards and product files and marks everything as real", async () => {
    const catalog = await loadSnapshotCatalog(memoryReader(layout(["دیوارکوب-یک", "دیوارکوب-دو"])));
    expect(catalog.source).toBe("snapshot");
    expect(catalog.products.map((p) => p.slug)).toEqual(["دیوارکوب-دو", "دیوارکوب-یک"].sort());
    expect(catalog.products.every((p) => p.isDemo === false)).toBe(true);
    expect(catalog.categories).toEqual([{ slug: "دیوارکوب", name: "دیوارکوب", isDemo: false }]);
  });

  it("lists a product once even if several shards mention it", async () => {
    const files = layout(["a-1"]);
    (files["catalog/manifest.json"].categories as unknown[]).push({ slug: "دوم", name: "دوم", count: 1, shard: "x" });
    Object.assign(files, { "catalog/categories/دوم.json": { category: { slug: "دوم", name: "دوم" }, products: [{ slug: "a-1" }] } });
    expect((await loadSnapshotCatalog(memoryReader(files))).products).toHaveLength(1);
  });

  it("fails loudly when the manifest or a category shard is missing (never ships an empty catalogue silently)", async () => {
    await expect(loadSnapshotCatalog(memoryReader({}))).rejects.toThrow("catalog_snapshot_manifest_missing");
    const files = layout(["a-1"]);
    delete (files as Record<string, unknown>)["catalog/categories/دیوارکوب.json"];
    await expect(loadSnapshotCatalog(memoryReader(files))).rejects.toThrow("catalog_snapshot_category_missing");
    await expect(loadSnapshotCatalog({ readText: async () => "{not json" })).rejects.toThrow("invalid_json");
  });

  it("skips one invalid product, reports it, and keeps the rest", async () => {
    const report: LoadReport = { skipped: [] };
    const files = layout(["good-1", "bad-price", "bad-slug", "gone"], {
      "bad-price": realProduct("bad-price", { priceToman: -5 }),
      "bad-slug": realProduct("another-slug"),
    });
    delete (files as Record<string, unknown>)["catalog/products/gone.json"];
    const catalog = await loadSnapshotCatalog(memoryReader(files), report);
    expect(catalog.products.map((p) => p.slug)).toEqual(["good-1"]);
    expect(report.skipped.map((s) => [s.slug, s.reason === "file_missing" ? "file_missing" : s.reason === "slug_mismatch" ? "slug_mismatch" : "invalid"]).sort()).toEqual([
      ["bad-price", "invalid"],
      ["bad-slug", "slug_mismatch"],
      ["gone", "file_missing"],
    ]);
  });

  it("rejects unsafe slugs and hostile fields instead of building pages for them", async () => {
    const report: LoadReport = { skipped: [] };
    const files = layout(["ok-1"]);
    (files["catalog/categories/دیوارکوب.json"].products as unknown[]).push({ slug: "ok-1" });
    await expect(loadSnapshotCatalog(memoryReader({ ...files, "catalog/categories/دیوارکوب.json": { products: [{ slug: "../etc/passwd" }] } }), report)).rejects.toThrow();
  });

  it("strips markup from product names", async () => {
    const catalog = await loadSnapshotCatalog(memoryReader(layout(["a-1"], { "a-1": realProduct("a-1", { name: "  <b>اثر</b>  نمونه " }) })));
    expect(catalog.products[0]?.name).toBe("اثر نمونه");
  });

  it("accepts the largest supported prices exactly", async () => {
    const catalog = await loadSnapshotCatalog(memoryReader(layout(["a-1"], { "a-1": realProduct("a-1", { priceToman: 1_000_000_000_000_000 }) })));
    expect(catalog.products[0]?.priceToman).toBe(1_000_000_000_000_000);
  });
});

describe("sample content", () => {
  it("is flagged as demo everywhere and carries no price or description", () => {
    const demo = demoSeoCatalog();
    expect(demo.source).toBe("demo");
    expect(demo.products.length).toBeGreaterThan(5);
    for (const p of demo.products) {
      expect(p.isDemo).toBe(true);
      expect(p.priceToman).toBeNull();
      expect(p.description).toBe("");
      expect(p.images.every((i) => i.placeholder && i.alt)).toBe(true);
    }
    expect(demo.categories.every((c) => c.isDemo)).toBe(true);
  });
});

describe("readers", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "jm-seo-"));
    const files = layout(["a-1"]);
    for (const [path, body] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), JSON.stringify(body));
    }
    await writeFile(join(dirname(dir), "jm-seo-secret.txt"), "secret");
  });
  afterAll(async () => rm(dir, { recursive: true, force: true }));

  it("reads from a directory, returns null for a missing file and refuses to leave the directory", async () => {
    const reader = dirReader(dir);
    expect((await loadSnapshotCatalog(reader)).products.map((p) => p.slug)).toEqual(["a-1"]);
    expect(await reader.readText("catalog/nope.json")).toBeNull();
    await expect(reader.readText("../jm-seo-secret.txt")).rejects.toThrow("outside_directory");
  });

  it("reads over HTTPS with encoded Persian paths, maps 404 to null and retries transient failures", async () => {
    const urls: string[] = [];
    let flaky = 0;
    const fetchImpl = (async (url: URL) => {
      urls.push(url.toString());
      if (url.pathname.endsWith("flaky.json") && flaky++ < 2) return new Response("", { status: 503 });
      if (url.pathname.endsWith("missing.json")) return new Response("", { status: 404 });
      return new Response('{"ok":true}');
    }) as unknown as typeof fetch;
    const reader = httpReader("https://media.example.ir/base", fetchImpl);
    expect(await reader.readText("catalog/categories/دیوارکوب.json")).toBe('{"ok":true}');
    expect(urls[0]).toBe("https://media.example.ir/base/catalog/categories/%D8%AF%DB%8C%D9%88%D8%A7%D8%B1%DA%A9%D9%88%D8%A8.json");
    expect(await reader.readText("catalog/missing.json")).toBeNull();
    expect(await reader.readText("catalog/flaky.json")).toBe('{"ok":true}');
    const alwaysDown = httpReader("https://media.example.ir", (async () => new Response("", { status: 500 })) as unknown as typeof fetch);
    await expect(alwaysDown.readText("catalog/manifest.json")).rejects.toThrow("catalog_snapshot_http_500");
  });

  it("requires HTTPS except for localhost", () => {
    expect(() => httpReader("http://media.example.ir")).toThrow("requires_https");
    expect(() => httpReader("http://127.0.0.1:9000")).not.toThrow();
  });
});

describe("categories without products", () => {
  it("are ignored (the backend lists them in the manifest but writes no shard for them)", async () => {
    const files = layout(["a-1"]);
    (files["catalog/manifest.json"].categories as unknown[]).push({ slug: "خالی", name: "خالی", count: 0, shard: "catalog/categories/خالی.json" });
    const catalog = await loadSnapshotCatalog(memoryReader(files));
    expect(catalog.categories.map((c) => c.slug)).toEqual(["دیوارکوب"]);
  });
});

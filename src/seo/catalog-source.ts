import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { z } from "zod";
import { SNAPSHOT_PATHS } from "@/domain/product/snapshot";
import { demoCategories, demoProducts } from "@/data/demo-catalog";
import { cleanText } from "./text";
import type { SeoCatalog, SeoCategory, SeoProduct } from "./types";
import { isValidSlug } from "./urls";

/**
 * Where the verified catalogue comes from at BUILD time (the site is a static export, nothing runs per request):
 *  - `CATALOG_SNAPSHOT_URL`: the public base URL of the S3-compatible bucket that the PostgreSQL backend's
 *    snapshot publisher writes (`catalog/manifest.json`, `catalog/categories/*.json`, `catalog/products/*.json`);
 *  - `CATALOG_SNAPSHOT_DIR`: the same files on disk (tests, offline builds);
 *  - neither: the built-in SAMPLE content, which is never indexable.
 * Only published products ever reach those files, so "published" is the verification gate.
 */
export interface SnapshotReader {
  /** The file's text, or `null` when it does not exist. Throws on any other failure. */
  readText(path: string): Promise<string | null>;
}

export function dirReader(dir: string): SnapshotReader {
  const root = resolve(dir);
  return {
    async readText(path) {
      const file = resolve(join(root, path));
      if (!file.startsWith(root + sep)) throw new Error("snapshot_path_outside_directory");
      try {
        return await readFile(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
  };
}

export function httpReader(baseUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = 20_000): SnapshotReader {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const local = base.hostname === "localhost" || base.hostname === "127.0.0.1";
  if (base.protocol !== "https:" && !local) throw new Error("catalog_snapshot_url_requires_https");
  return {
    async readText(path) {
      const url = new URL(path.split("/").map(encodeURIComponent).join("/"), base);
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/json" } });
          if (response.status === 404) return null;
          if (!response.ok) throw new Error(`catalog_snapshot_http_${response.status}`);
          return await response.text();
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("catalog_snapshot_unreachable");
    },
  };
}

// ---- validation: the shapes written by server/catalog/snapshot-publisher.ts (src/domain/product/snapshot.ts) -----

const slug = z.string().refine(isValidSlug, "invalid_slug");
const toman = z.number().int().min(0).max(1_000_000_000_000_000).nullable();
const publicProductSchema = z.object({
  slug,
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10_000),
  category: z.object({ slug, name: z.string().trim().min(1).max(200) }).nullable(),
  fulfillment: z.enum(["unique", "stocked", "made_to_order"]),
  priceToman: toman,
  availability: z.enum(["in_stock", "sold_out", "made_to_order"]),
  leadTimeDays: z.number().int().min(1).max(365).nullable(),
  images: z.array(z.object({ url: z.string().min(1).max(2000), alt: z.string().max(500) })).max(50),
  variants: z
    .array(z.object({ sku: z.string().max(100), options: z.record(z.string(), z.string()), priceToman: toman, available: z.boolean() }))
    .max(100),
});
const manifestSchema = z.object({ version: z.number(), categories: z.array(z.object({ slug, name: z.string(), count: z.number() })) });
const shardSchema = z.object({ products: z.array(z.object({ slug })) });

export interface LoadReport {
  skipped: Array<{ slug: string; reason: string }>;
}

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i] as T);
      }
    }),
  );
  return out;
}

const parseJson = (text: string, what: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`catalog_snapshot_invalid_json: ${what}`);
  }
};

/**
 * Reads every published product listed by the manifest. A missing or malformed manifest is an error (the build must
 * not silently ship a site with no catalogue). A single product that fails validation is skipped and reported, so one
 * bad record cannot take the whole site down; skipped products simply get no page.
 */
export async function loadSnapshotCatalog(reader: SnapshotReader, report: LoadReport = { skipped: [] }): Promise<SeoCatalog> {
  const manifestText = await reader.readText(SNAPSHOT_PATHS.manifest);
  if (manifestText === null) throw new Error("catalog_snapshot_manifest_missing");
  const manifest = manifestSchema.parse(parseJson(manifestText, "manifest"));

  // A category without published products is listed in the manifest but may have no shard file: nothing to show.
  const filled = manifest.categories.filter((c) => c.count > 0);
  const slugs = new Set<string>();
  for (const category of filled) {
    const text = await reader.readText(SNAPSHOT_PATHS.category(category.slug));
    if (text === null) throw new Error(`catalog_snapshot_category_missing: ${category.slug}`);
    for (const card of shardSchema.parse(parseJson(text, `category ${category.slug}`)).products) slugs.add(card.slug);
  }

  const loaded = await pool([...slugs].sort(), 8, async (productSlug): Promise<SeoProduct | null> => {
    const text = await reader.readText(SNAPSHOT_PATHS.product(productSlug));
    if (text === null) {
      report.skipped.push({ slug: productSlug, reason: "file_missing" });
      return null;
    }
    const parsed = publicProductSchema.safeParse(parseJson(text, `product ${productSlug}`));
    if (!parsed.success || parsed.data.slug !== productSlug) {
      report.skipped.push({ slug: productSlug, reason: parsed.success ? "slug_mismatch" : parsed.error.issues[0]?.message ?? "invalid" });
      return null;
    }
    return { ...parsed.data, name: cleanText(parsed.data.name), isDemo: false };
  });
  const products = loaded.filter((p): p is SeoProduct => p !== null);
  const categories: SeoCategory[] = filled.map((c) => ({ slug: c.slug, name: cleanText(c.name), isDemo: false }));
  return { source: "snapshot", products, categories };
}

/** The built-in sample content in the same shape. Flagged as demo everywhere, so it is never indexed or described as real. */
export function demoSeoCatalog(): SeoCatalog {
  const categoryName = new Map(demoCategories.map((c) => [c.slug, c.name]));
  return {
    source: "demo",
    categories: demoCategories.map((c) => ({ slug: c.slug, name: c.name, isDemo: true })),
    products: demoProducts.map((p) => ({
      slug: p.slug,
      name: p.title,
      description: "",
      category: { slug: p.categorySlug, name: categoryName.get(p.categorySlug) ?? p.categorySlug },
      fulfillment: p.isUnique ? "unique" : "stocked",
      priceToman: p.priceToman,
      availability: "in_stock",
      leadTimeDays: null,
      images: p.images.map((i) => ({ url: "", alt: i.alt, placeholder: { tone: i.tone, motif: i.motif } })),
      variants: [],
      isDemo: true,
    })),
  };
}

/** Reads CATALOG_SNAPSHOT_URL / CATALOG_SNAPSHOT_DIR. */
export type SourceEnv = Record<string, string | undefined>;

let cached: Promise<SeoCatalog> | null = null;

/** Memoised per build process: pages, metadata and the sitemap all see the same catalogue. */
export function loadSeoCatalog(env: SourceEnv = process.env): Promise<SeoCatalog> {
  if (!cached) {
    const report: LoadReport = { skipped: [] };
    const reader = env.CATALOG_SNAPSHOT_DIR ? dirReader(env.CATALOG_SNAPSHOT_DIR) : env.CATALOG_SNAPSHOT_URL ? httpReader(env.CATALOG_SNAPSHOT_URL) : null;
    cached = (reader ? loadSnapshotCatalog(reader, report) : Promise.resolve(demoSeoCatalog())).then((catalog) => {
      for (const s of report.skipped) console.warn(`[seo] skipped product "${s.slug}": ${s.reason}`);
      return catalog;
    });
    // A failed load must fail the build every time it is asked for, not just once.
  }
  return cached;
}


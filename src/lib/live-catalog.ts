import { SNAPSHOT_PATHS } from "@/domain/product/snapshot";
import { cardShardSchema, manifestSchema, publicProductSchema } from "@/domain/product/snapshot-schema";
import type { PublicCard, PublicProduct } from "@/domain/product/snapshot";
import { SLUG_PATTERN } from "@/seo/urls";

/**
 * The storefront's LIVE catalogue: the shopper's browser reads the public snapshot files that the admin backend
 * writes when a product is published, changed, unpublished or archived. No site rebuild or deployment is involved,
 * so a change shows up as soon as the CDN cache (≤ about a minute) lets go of the old file.
 *
 * The base URL is public (`NEXT_PUBLIC_CATALOG_URL`, inlined into the build). The files contain published data only;
 * drafts and archived products have no file at all, so there is nothing to filter and nothing to leak.
 */
export type LiveEnv = Record<string, string | undefined>;

/** The configured base URL, or null when the storefront has no live catalogue (it then shows its built-in sample content). */
export function liveCatalogBase(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  if (url.username || url.password) return null;
  return value.replace(/\/+$/, "");
}

/** Image URLs come from the data files: only http(s) (or site-relative) addresses ever reach an <img>. */
export function safeImageUrl(url: string): string | null {
  return /^https?:\/\//i.test(url) || url.startsWith("/") ? url : null;
}

export const isLiveSlug = (slug: string): boolean => slug.length > 0 && slug.length <= 100 && SLUG_PATTERN.test(slug);

export interface LiveCategory {
  slug: string;
  name: string;
  count: number;
}
export interface LiveHome {
  categories: LiveCategory[];
  /** Every published card, each product once, tagged with the categories whose shards listed it. */
  cards: Array<PublicCard & { categorySlugs: string[] }>;
}

export class LiveCatalogError extends Error {
  constructor(public code: "unreachable" | "invalid") {
    super(code);
  }
}

export function createLiveCatalog(baseUrl: string, fetchImpl: typeof fetch = fetch) {
  const base = `${baseUrl.replace(/\/+$/, "")}/`;

  /** The parsed JSON, `null` when the file does not exist (no manifest yet / product not published). */
  async function readJson(path: string): Promise<unknown | null> {
    const url = new URL(path.split("/").map(encodeURIComponent).join("/"), base);
    let response: Response;
    try {
      response = await fetchImpl(url, { headers: { accept: "application/json" } });
    } catch {
      throw new LiveCatalogError("unreachable");
    }
    if (response.status === 404 || response.status === 403) return null; // object stores answer 403 for a missing key without list permission
    if (!response.ok) throw new LiveCatalogError("unreachable");
    try {
      return await response.json();
    } catch {
      throw new LiveCatalogError("invalid");
    }
  }

  return {
    async loadHome(): Promise<LiveHome> {
      const rawManifest = await readJson(SNAPSHOT_PATHS.manifest);
      if (rawManifest === null) return { categories: [], cards: [] }; // nothing has been published yet
      const manifest = manifestSchema.safeParse(rawManifest);
      if (!manifest.success) throw new LiveCatalogError("invalid");

      const categories = manifest.data.categories.filter((c) => c.count > 0);
      const shards = await Promise.all(
        categories.map(async (c) => {
          const raw = await readJson(SNAPSHOT_PATHS.category(c.slug));
          if (raw === null) return { slug: c.slug, products: [] as PublicCard[] };
          const parsed = cardShardSchema.safeParse(raw);
          if (!parsed.success) throw new LiveCatalogError("invalid");
          return { slug: c.slug, products: parsed.data.products as PublicCard[] };
        }),
      );
      const bySlug = new Map<string, PublicCard & { categorySlugs: string[] }>();
      for (const shard of shards) {
        for (const card of shard.products) {
          const known = bySlug.get(card.slug);
          if (known) known.categorySlugs.push(shard.slug);
          else bySlug.set(card.slug, { ...card, categorySlugs: [shard.slug] });
        }
      }
      return { categories, cards: [...bySlug.values()] };
    },

    /** `null` = not (or no longer) published. */
    async loadProduct(slug: string): Promise<PublicProduct | null> {
      if (!isLiveSlug(slug)) return null;
      const raw = await readJson(SNAPSHOT_PATHS.product(slug));
      if (raw === null) return null;
      const parsed = publicProductSchema.safeParse(raw);
      if (!parsed.success || parsed.data.slug !== slug) throw new LiveCatalogError("invalid");
      return parsed.data as PublicProduct;
    },
  };
}

/** The product page of the live catalogue (a static page that reads `?slug=` in the browser). */
export const liveProductHref = (slug: string): string => `/product?slug=${encodeURIComponent(slug)}`;

/** Lowest price a product is shown "from": its variants' lowest price, else its own. */
export function livePrice(product: Pick<PublicProduct, "priceToman" | "variants">): { amount: number | null; from: boolean } {
  const prices = product.variants.map((v) => v.priceToman).filter((p): p is number => p !== null);
  if (prices.length === 0) return { amount: product.priceToman, from: false };
  const min = Math.min(...prices);
  return { amount: min, from: new Set(prices).size > 1 };
}

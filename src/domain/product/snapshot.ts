import type { Fulfillment, ProductListRow, StoredProduct } from "./types";

/**
 * Public catalogue snapshots: sanitised JSON files that the static storefront
 * reads from a public, CDN-cached bucket. They contain published data only and
 * deliberately omit ids, status, exact stock counts, versions and timestamps of
 * edits, so scraping them reveals nothing beyond what shoppers can already see.
 */
export const SNAPSHOT_PATHS = {
  manifest: "catalog/manifest.json",
  category: (slug: string) => `catalog/categories/${slug}.json`,
  product: (slug: string) => `catalog/products/${slug}.json`,
} as const;

export type Availability = "in_stock" | "sold_out" | "made_to_order";

export interface PublicImage {
  url: string;
  alt: string;
}

export interface PublicVariant {
  sku: string;
  options: Record<string, string>;
  priceToman: number | null;
  available: boolean;
}

export interface PublicProduct {
  slug: string;
  name: string;
  description: string;
  /** Editor-chosen page title / meta description (null = generated automatically by the storefront build). */
  seoTitle: string | null;
  seoDescription: string | null;
  category: { slug: string; name: string } | null;
  fulfillment: Fulfillment;
  priceToman: number | null;
  availability: Availability;
  leadTimeDays: number | null;
  images: PublicImage[];
  variants: PublicVariant[];
}

export interface PublicCard {
  slug: string;
  name: string;
  fulfillment: Fulfillment;
  priceToman: number | null;
  /** Lowest variant price, present only for products with variants. */
  priceFromToman: number | null;
  availability: Availability;
  cover: PublicImage | null;
}

export interface Manifest {
  /** Increases on every publish; clients use it to bust caches. */
  version: number;
  categories: Array<{ slug: string; name: string; count: number; shard: string }>;
}

export interface SnapshotContext {
  /** Public base URL of the image bucket, without trailing slash. May be empty for relative URLs. */
  imageBaseUrl: string;
  categoryById: ReadonlyMap<string, { slug: string; name: string }>;
}

export function imageUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, "")}/${key}`;
}

function variantAvailable(fulfillment: Fulfillment, inventory: number | null): boolean {
  return fulfillment === "made_to_order" || (inventory ?? 0) > 0;
}

export function productAvailability(p: Pick<StoredProduct, "fulfillment" | "inventory" | "variants">): Availability {
  if (p.fulfillment === "made_to_order") return "made_to_order";
  const available =
    p.variants.length > 0 ? p.variants.some((v) => (v.inventory ?? 0) > 0) : (p.inventory ?? 0) > 0;
  return available ? "in_stock" : "sold_out";
}

export function toPublicProduct(p: StoredProduct, ctx: SnapshotContext): PublicProduct {
  return {
    slug: p.slug,
    name: p.name,
    description: p.description,
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
    category: (p.categoryId && ctx.categoryById.get(p.categoryId)) || null,
    fulfillment: p.fulfillment,
    priceToman: p.priceToman,
    availability: productAvailability(p),
    leadTimeDays: p.leadTimeDays,
    images: [...p.images]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({ url: imageUrl(ctx.imageBaseUrl, i.key), alt: i.alt })),
    variants: [...p.variants]
      .sort((a, b) => a.position - b.position)
      .map((v) => ({
        sku: v.sku,
        options: v.options,
        priceToman: v.priceToman ?? p.priceToman,
        available: variantAvailable(p.fulfillment, v.inventory),
      })),
  };
}

export function toPublicCard(row: ProductListRow, ctx: SnapshotContext): PublicCard {
  const availability: Availability =
    row.fulfillment === "made_to_order"
      ? "made_to_order"
      : (row.variantCount > 0 ? row.variantAvailableCount > 0 : (row.inventory ?? 0) > 0)
        ? "in_stock"
        : "sold_out";
  return {
    slug: row.slug,
    name: row.name,
    fulfillment: row.fulfillment,
    priceToman: row.priceToman,
    priceFromToman: row.variantCount > 0 ? row.variantMinPriceToman : null,
    availability,
    cover: row.coverKey ? { url: imageUrl(ctx.imageBaseUrl, row.coverKey), alt: row.coverAlt ?? "" } : null,
  };
}

export function serializeSnapshot(value: unknown): string {
  return JSON.stringify(value);
}

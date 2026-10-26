export const PRODUCT_STATUSES = ["draft", "published", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/**
 * unique         one-of-a-kind handmade piece (stock is 1, or 0 once sold)
 * stocked        made in advance, tracked by inventory count
 * made_to_order  produced after the order; has a lead time, no inventory
 */
export const FULFILLMENTS = ["unique", "stocked", "made_to_order"] as const;
export type Fulfillment = (typeof FULFILLMENTS)[number];

export interface StoredImage {
  id: string;
  /** Object key in the image bucket, e.g. `images/<productId>/<uuid>.webp`. */
  key: string;
  alt: string;
  position: number;
}

export interface StoredVariant {
  id: string;
  sku: string;
  options: Record<string, string>;
  /** Overrides the product price when set. */
  priceToman: number | null;
  inventory: number | null;
  position: number;
}

export interface StoredProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  categoryId: string | null;
  status: ProductStatus;
  fulfillment: Fulfillment;
  /** Integer Toman; null = not announced. */
  priceToman: number | null;
  inventory: number | null;
  leadTimeDays: number | null;
  images: StoredImage[];
  variants: StoredVariant[];
  /** Optimistic-concurrency counter, incremented on every update. */
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

/** Flattened row used by lists and snapshot cards (no child fetches needed). */
export interface ProductListRow {
  id: string;
  slug: string;
  name: string;
  status: ProductStatus;
  fulfillment: Fulfillment;
  categoryId: string | null;
  priceToman: number | null;
  inventory: number | null;
  leadTimeDays: number | null;
  coverKey: string | null;
  coverAlt: string | null;
  variantCount: number;
  variantMinPriceToman: number | null;
  /** Number of variants that can currently be bought. */
  variantAvailableCount: number;
  version: number;
  updatedAt: string;
  publishedAt: string | null;
}

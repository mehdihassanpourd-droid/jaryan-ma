import type { StoredProduct } from "./types";

/** Test/demo helper: a valid stored product with overrides. */
export function storedProduct(overrides: Partial<StoredProduct> = {}): StoredProduct {
  return {
    id: "p1",
    slug: "demo-wall-hanging",
    name: "دیوارکوب نمونه",
    description: "توضیح نمونه",
    categoryId: "c1",
    status: "published",
    fulfillment: "unique",
    priceToman: 1000,
    inventory: 1,
    leadTimeDays: null,
    images: [{ id: "i1", key: "images/p1/aaa.webp", alt: "تصویر نمونه", position: 0 }],
    variants: [],
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    publishedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

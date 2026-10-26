import { describe, expect, it } from "vitest";
import { storedProduct } from "./fixtures";
import { productAvailability, serializeSnapshot, toPublicCard, toPublicProduct, type SnapshotContext } from "./snapshot";
import type { ProductListRow } from "./types";

const ctx: SnapshotContext = {
  imageBaseUrl: "https://img.example.test/",
  categoryById: new Map([["c1", { slug: "wall-hangings", name: "دیوارکوب بافته" }]]),
};

describe("toPublicProduct", () => {
  it("never leaks internal fields", () => {
    const json = serializeSnapshot(toPublicProduct(storedProduct({ id: "internal-id-9", inventory: 7, fulfillment: "stocked" }), ctx));
    for (const forbidden of ['"id"', '"status"', '"inventory"', '"version"', '"createdAt"', '"updatedAt"', '"publishedAt"', '"categoryId"', "internal-id-9"]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
  });

  it("builds absolute image URLs in order and resolves the category", () => {
    const p = toPublicProduct(
      storedProduct({
        images: [
          { id: "b", key: "images/p1/b.webp", alt: "دوم", position: 1 },
          { id: "a", key: "images/p1/a.webp", alt: "اول", position: 0 },
        ],
      }),
      ctx,
    );
    expect(p.images.map((i) => i.url)).toEqual(["https://img.example.test/images/p1/a.webp", "https://img.example.test/images/p1/b.webp"]);
    expect(p.category).toEqual({ slug: "wall-hangings", name: "دیوارکوب بافته" });
  });

  it("derives availability without exposing counts", () => {
    expect(productAvailability(storedProduct({ inventory: 1 }))).toBe("in_stock");
    expect(productAvailability(storedProduct({ inventory: 0 }))).toBe("sold_out");
    expect(productAvailability(storedProduct({ fulfillment: "made_to_order", inventory: null, leadTimeDays: 10 }))).toBe("made_to_order");
    const withVariants = storedProduct({
      fulfillment: "stocked",
      inventory: null,
      variants: [
        { id: "v1", sku: "S", options: { size: "S" }, priceToman: null, inventory: 0, position: 0 },
        { id: "v2", sku: "L", options: { size: "L" }, priceToman: 2000, inventory: 3, position: 1 },
      ],
    });
    expect(productAvailability(withVariants)).toBe("in_stock");
    const pub = toPublicProduct(withVariants, ctx);
    expect(pub.variants).toEqual([
      { sku: "S", options: { size: "S" }, priceToman: 1000, available: false },
      { sku: "L", options: { size: "L" }, priceToman: 2000, available: true },
    ]);
  });
});

describe("toPublicCard", () => {
  const row: ProductListRow = {
    id: "p1", slug: "demo", name: "نمونه", status: "published", fulfillment: "stocked", categoryId: "c1",
    priceToman: 1000, inventory: null, leadTimeDays: null, coverKey: "images/p1/a.webp", coverAlt: "تصویر",
    variantCount: 2, variantMinPriceToman: 900, variantAvailableCount: 1, version: 3,
    updatedAt: "x", publishedAt: "y",
  };
  it("uses variant data for price-from and availability, and hides internals", () => {
    const card = toPublicCard(row, ctx);
    expect(card).toEqual({
      slug: "demo", name: "نمونه", fulfillment: "stocked", priceToman: 1000, priceFromToman: 900,
      availability: "in_stock", cover: { url: "https://img.example.test/images/p1/a.webp", alt: "تصویر" },
    });
    expect(JSON.stringify(card)).not.toContain("version");
  });
  it("handles products with no image and sold-out unique pieces", () => {
    const card = toPublicCard({ ...row, coverKey: null, variantCount: 0, variantMinPriceToman: null, variantAvailableCount: 0, fulfillment: "unique", inventory: 0 }, ctx);
    expect(card.cover).toBeNull();
    expect(card.availability).toBe("sold_out");
    expect(card.priceFromToman).toBeNull();
  });
});

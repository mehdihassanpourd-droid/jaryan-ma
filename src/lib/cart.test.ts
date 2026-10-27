import { describe, expect, it } from "vitest";
import { addLine, cartCount, lineKey, parseCart, removeLine, serializeCart, setLineQuantity } from "./cart";
import { cartTotal, priceLine, quantityLimit } from "./cart-pricing";
import type { PublicProduct } from "@/domain/product/snapshot";

const product = (extra: Partial<PublicProduct> = {}): PublicProduct => ({
  slug: "rug", name: "گلیم", description: "", seoTitle: null, seoDescription: null, category: null, fulfillment: "stocked", priceToman: 1_000_000,
  availability: "in_stock", leadTimeDays: null, images: [], variants: [], ...extra,
});

describe("cart storage format", () => {
  it("round-trips, merges duplicates and survives garbage", () => {
    const lines = [{ slug: "rug", sku: null, quantity: 2 }, { slug: "mat", sku: "M-1", quantity: 1 }];
    expect(parseCart(serializeCart(lines))).toEqual(lines);
    expect(parseCart(null)).toEqual([]);
    expect(parseCart("not json")).toEqual([]);
    expect(parseCart('{"a":1}')).toEqual([]);
    expect(parseCart(JSON.stringify([{ slug: "rug", sku: null, quantity: 2 }, { slug: "rug", sku: null, quantity: 3 }]))).toEqual([{ slug: "rug", sku: null, quantity: 5 }]);
  });

  it("drops entries a tampered storage could hold: bad slugs, skus, quantities, prices smuggled in", () => {
    const raw = JSON.stringify([
      { slug: "../evil", sku: null, quantity: 1 },
      { slug: "ok", sku: 5, quantity: 1 },
      { slug: "ok", sku: "", quantity: 1 },
      { slug: "ok", sku: null, quantity: 0 },
      { slug: "ok", sku: null, quantity: "2" },
      { slug: "ok", sku: null, quantity: Infinity },
      null,
      "x",
      { slug: "fine", sku: "A-1", quantity: 999, priceToman: 1 },
    ]);
    expect(parseCart(raw)).toEqual([{ slug: "fine", sku: "A-1", quantity: 20 }]);
  });

  it("limits lines (50) and quantity per line (20)", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ slug: `p${i}`, sku: null, quantity: 1 }));
    expect(parseCart(JSON.stringify(many))).toHaveLength(50);
    let lines = addLine([], { slug: "a", sku: null, quantity: 15 });
    lines = addLine(lines, { slug: "a", sku: null, quantity: 15 });
    expect(lines).toEqual([{ slug: "a", sku: null, quantity: 20 }]);
  });
});

describe("cart operations", () => {
  it("adds (merging the same product+variant), changes quantity, removes and counts", () => {
    let lines = addLine([], { slug: "a", sku: "S", quantity: 1 });
    lines = addLine(lines, { slug: "a", sku: "L", quantity: 1 });
    lines = addLine(lines, { slug: "a", sku: "S", quantity: 2 });
    expect(lines).toEqual([{ slug: "a", sku: "S", quantity: 3 }, { slug: "a", sku: "L", quantity: 1 }]);
    expect(cartCount(lines)).toBe(4);
    lines = setLineQuantity(lines, lineKey({ slug: "a", sku: "L" }), 7);
    expect(lines[1]?.quantity).toBe(7);
    expect(setLineQuantity(lines, lineKey({ slug: "a", sku: "L" }), 0)[1]?.quantity).toBe(1);
    expect(removeLine(lines, lineKey({ slug: "a", sku: "S" }))).toEqual([{ slug: "a", sku: "L", quantity: 7 }]);
  });
});

describe("pricing a line against the CURRENT product", () => {
  it("uses the live unit price and an exact total", () => {
    const p = priceLine({ slug: "rug", sku: null, quantity: 3 }, product());
    expect(p).toMatchObject({ ok: true, unitPriceToman: 1_000_000, quantity: 3, totalToman: 3_000_000n });
  });

  it("uses the variant's own price and label", () => {
    const withVariants = product({ variants: [{ sku: "S", options: { اندازه: "۵۰×۷۰" }, priceToman: 500_000, available: true }, { sku: "L", options: { اندازه: "۷۰×۱۰۰" }, priceToman: 800_000, available: false }] });
    expect(priceLine({ slug: "rug", sku: "S", quantity: 2 }, withVariants)).toMatchObject({ ok: true, unitPriceToman: 500_000, variantLabel: "۵۰×۷۰", totalToman: 1_000_000n });
    expect(priceLine({ slug: "rug", sku: "L", quantity: 1 }, withVariants)).toMatchObject({ ok: false, reason: "sold_out" });
    expect(priceLine({ slug: "rug", sku: "XL", quantity: 1 }, withVariants)).toMatchObject({ ok: false, reason: "variant_not_found" });
    expect(priceLine({ slug: "rug", sku: null, quantity: 1 }, withVariants)).toMatchObject({ ok: false, reason: "variant_not_found" });
  });

  it("flags what cannot be ordered: unpublished, sold out, no price, a variant on a product without variants", () => {
    expect(priceLine({ slug: "x", sku: null, quantity: 1 }, null)).toMatchObject({ ok: false, reason: "not_found" });
    expect(priceLine({ slug: "rug", sku: null, quantity: 1 }, product({ availability: "sold_out" }))).toMatchObject({ ok: false, reason: "sold_out" });
    expect(priceLine({ slug: "rug", sku: null, quantity: 1 }, product({ priceToman: null }))).toMatchObject({ ok: false, reason: "no_price" });
    expect(priceLine({ slug: "rug", sku: "S", quantity: 1 }, product())).toMatchObject({ ok: false, reason: "variant_not_found" });
  });

  it("a unique piece is always one; made-to-order needs no stock", () => {
    const unique = product({ fulfillment: "unique" });
    expect(quantityLimit(unique)).toBe(1);
    expect(priceLine({ slug: "rug", sku: null, quantity: 5 }, unique)).toMatchObject({ ok: true, quantity: 1, totalToman: 1_000_000n });
    const made = product({ fulfillment: "made_to_order", availability: "made_to_order" });
    expect(priceLine({ slug: "rug", sku: null, quantity: 2 }, made)).toMatchObject({ ok: true, madeToOrder: true, totalToman: 2_000_000n });
  });

  it("totals are exact above 2^53 and skip unavailable lines", () => {
    const big = priceLine({ slug: "rug", sku: null, quantity: 19 }, product({ priceToman: 999_999_999_999_999 }));
    const sold = priceLine({ slug: "rug", sku: null, quantity: 1 }, product({ availability: "sold_out" }));
    expect(big.ok && big.totalToman).toBe(18_999_999_999_999_981n);
    expect(BigInt(Number(18_999_999_999_999_981n))).not.toBe(18_999_999_999_999_981n); // a Number would have rounded it
    expect(cartTotal([big, sold])).toBe(18_999_999_999_999_981n);
  });
});

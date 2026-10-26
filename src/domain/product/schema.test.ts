import { describe, expect, it } from "vitest";
import { messageFa, productIssueMessagesFa } from "./messages.fa";
import { PRODUCT_ISSUE_CODES, validateProductInput } from "./schema";

const IMG = { key: "images/p1/abc-123.webp", alt: "تصویر" };
const base = { name: "دیوارکوب نمونه", fulfillment: "unique" as const };

function codes(raw: unknown): string[] {
  const r = validateProductInput(raw);
  return r.ok ? [] : r.issues.map((i) => i.code);
}

describe("product validation: fulfilment rules", () => {
  it("accepts a draft unique product and defaults inventory to 1 (slug stays server-derived)", () => {
    const r = validateProductInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.inventory).toBe(1);
      expect(r.value.slug).toBeUndefined();
      expect(r.value.status).toBe("draft");
    }
  });

  it("unique: no variants, inventory only 0 or 1, no lead time", () => {
    const variant = { sku: "A-1", options: { size: "L" } };
    expect(codes({ ...base, variants: [variant] })).toContain("variants_not_allowed_for_unique");
    expect(codes({ ...base, inventory: 5 })).toContain("unique_inventory_must_be_0_or_1");
    expect(codes({ ...base, inventory: 0 })).toEqual([]);
    expect(codes({ ...base, leadTimeDays: 7 })).toContain("lead_time_only_for_made_to_order");
  });

  it("stocked: needs inventory, or inventory on every variant", () => {
    const stocked = { name: "کوسن نمونه", fulfillment: "stocked" as const };
    expect(codes(stocked)).toContain("inventory_required");
    expect(codes({ ...stocked, inventory: 3 })).toEqual([]);
    const v = (sku: string, inventory: number | null) => ({ sku, options: { size: sku }, inventory });
    expect(codes({ ...stocked, inventory: 3, variants: [v("S", 1)] })).toContain("inventory_on_variants");
    expect(codes({ ...stocked, variants: [v("S", null)] })).toContain("variant_inventory_required");
    expect(codes({ ...stocked, variants: [v("S", 2), v("L", 0)] })).toEqual([]);
  });

  it("made to order: needs a lead time and has no inventory", () => {
    const mto = { name: "رانر سفارشی", fulfillment: "made_to_order" as const };
    expect(codes(mto)).toContain("lead_time_required");
    expect(codes({ ...mto, leadTimeDays: 14 })).toEqual([]);
    expect(codes({ ...mto, leadTimeDays: 14, inventory: 2 })).toContain("inventory_not_allowed_for_made_to_order");
    const variant = { sku: "X", options: { size: "L" }, inventory: 1 };
    expect(codes({ ...mto, leadTimeDays: 14, variants: [variant] })).toContain("variant_inventory_not_allowed");
  });

  it("variants: unique SKUs and consistent option names", () => {
    const stocked = { name: "کوسن نمونه", fulfillment: "stocked" as const };
    const a = { sku: "A", options: { size: "S" }, inventory: 1 };
    expect(codes({ ...stocked, variants: [a, { ...a }] })).toContain("duplicate_sku");
    expect(codes({ ...stocked, variants: [a, { sku: "B", options: { color: "سبز" }, inventory: 1 }] })).toContain(
      "variant_options_mismatch",
    );
  });
});

describe("product validation: publishing", () => {
  const ready = { ...base, categoryId: "c1", priceToman: 1000, images: [IMG], status: "published" as const };

  it("accepts a complete product", () => {
    expect(codes(ready)).toEqual([]);
  });

  it.each([
    ["category_required_to_publish", { categoryId: null }],
    ["image_required_to_publish", { images: [] }],
    ["price_required_to_publish", { priceToman: null }],
    ["price_required_to_publish", { priceToman: 0 }],
  ])("blocks publishing: %s", (code, patch) => {
    expect(codes({ ...ready, ...patch })).toContain(code);
  });

  it("with variants every variant needs an effective price", () => {
    const stocked = { ...ready, fulfillment: "stocked" as const, inventory: null, priceToman: null };
    const v = (sku: string, priceToman: number | null) => ({ sku, options: { size: sku }, inventory: 1, priceToman });
    expect(codes({ ...stocked, variants: [v("S", 100), v("L", null)] })).toContain("price_required_to_publish");
    expect(codes({ ...stocked, variants: [v("S", 100), v("L", 200)] })).toEqual([]);
  });

  it("drafts may be incomplete", () => {
    expect(codes({ ...base, status: "draft" })).toEqual([]);
  });
});

describe("product validation: input hygiene", () => {
  it("rejects bad prices, keys and text", () => {
    expect(codes({ ...base, priceToman: 1.5 })).not.toEqual([]);
    expect(codes({ ...base, priceToman: -1 })).not.toEqual([]);
    expect(codes({ ...base, priceToman: 2_000_000_000 })).toEqual([]);
    expect(codes({ ...base, priceToman: 2_000_000_001 })).not.toEqual([]); // PostgreSQL INTEGER ceiling
    expect(codes({ ...base, images: [{ key: "../../etc/passwd", alt: "" }] })).not.toEqual([]);
    expect(codes({ ...base, images: [{ key: "images/p1/a.svg", alt: "" }] })).not.toEqual([]);
    expect(codes({ ...base, name: "x" })).not.toEqual([]);
    expect(codes({ ...base, fulfillment: "dropship" })).not.toEqual([]);
  });

  it("fixes Arabic letters in names", () => {
    const r = validateProductInput({ ...base, name: "كيف نمونه" });
    expect(r.ok && r.value.name).toBe("کیف نمونه");
  });

  it("limits images and variants", () => {
    const images = Array.from({ length: 13 }, (_, i) => ({ key: `images/p1/a${i}.webp`, alt: "" }));
    expect(codes({ ...base, images })).not.toEqual([]);
  });
});

describe("Persian messages", () => {
  it("covers every validation code", () => {
    for (const code of PRODUCT_ISSUE_CODES) {
      expect(productIssueMessagesFa[code], code).toBeTruthy();
    }
    expect(messageFa("something_unknown")).toContain("معتبر");
  });
});

import { describe, expect, it } from "vitest";
import { MAX_TOMAN } from "@/domain/money";
import { storedProduct } from "@/domain/product/fixtures";
import { duplicateBody, emptyForm, fromStored, moveItem, newVariantId, serializeForm, toBody, validateForm, type ProductForm } from "./product-form";

const publishable = (over: Partial<ProductForm> = {}): ProductForm => ({
  ...emptyForm(),
  name: "پرده بافته",
  categoryId: "cat_1",
  price: "۴٬۵۰۰٬۰۰۰",
  images: [{ key: "images/p1/i1.webp", alt: "نمونه" }],
  ...over,
});

describe("product form", () => {
  it("round-trips a stored product without changing it", () => {
    const p = storedProduct({ priceToman: MAX_TOMAN, seoTitle: "عنوان", seoDescription: null });
    const form = fromStored(p);
    expect(toBody(form).body).toMatchObject({ priceToman: MAX_TOMAN, seoTitle: "عنوان", name: p.name });
  });

  it("reports unparsable numbers against their own field instead of coercing", () => {
    const { errors } = toBody(publishable({ price: "12.5", inventory: "abc" }));
    expect(Object.keys(errors).sort()).toEqual(["inventory", "priceToman"]);
  });

  it("an unchanged form is not dirty, an edited one is", () => {
    const form = publishable();
    const saved = serializeForm(form);
    expect(serializeForm({ ...form })).toBe(saved);
    expect(serializeForm({ ...form, name: "دیگر" })).not.toBe(saved);
  });

  it("draft may be incomplete; publishing needs category, image and price", () => {
    expect(validateForm({ ...emptyForm(), name: "پیش‌نویس" }, "draft").ok).toBe(true);
    const r = validateForm({ ...emptyForm(), name: "کامل نیست" }, "published");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors)).toEqual(expect.arrayContaining(["categoryId", "images", "priceToman"]));
    expect(validateForm(publishable(), "published").ok).toBe(true);
  });

  it("made-to-order needs a lead time and sends no inventory", () => {
    const r = validateForm(publishable({ fulfillment: "made_to_order", inventory: "5" }), "published");
    expect(r.ok).toBe(false);
    const ok = validateForm(publishable({ fulfillment: "made_to_order", leadTimeDays: "14" }), "published");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.body).toMatchObject({ inventory: null, leadTimeDays: 14 });
  });

  it("stocked variants carry per-variant price and stock", () => {
    const form = publishable({
      fulfillment: "stocked",
      optionNames: ["اندازه"],
      variants: [
        { id: newVariantId(), sku: "A-S", values: ["کوچک"], price: "۱۰۰", inventory: "3" },
        { id: newVariantId(), sku: "A-L", values: ["بزرگ"], price: "", inventory: "0" },
      ],
    });
    const r = validateForm(form, "published");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toMatchObject({ inventory: null, variants: [{ sku: "A-S", priceToman: 100, inventory: 3, options: { اندازه: "کوچک" } }, { sku: "A-L", priceToman: null, inventory: 0 }] });
  });

  it("duplicates as a draft with new SKUs, copied images and no SEO overrides", () => {
    const p = storedProduct({ name: "اثر", status: "published", seoTitle: "x", fulfillment: "stocked", inventory: null, variants: [{ id: "v", sku: "SKU-1", options: { رنگ: "سبز" }, priceToman: 10, inventory: 2, position: 0 }] });
    const first = duplicateBody(p, 1);
    expect(first).toMatchObject({ name: "اثر (کپی)", status: "draft", seoTitle: null, seoDescription: null });
    expect(first.variants).toMatchObject([{ sku: "SKU-1-copy" }]);
    expect(duplicateBody(p, 2).variants).toMatchObject([{ sku: "SKU-1-copy2" }]);
    expect(first).not.toHaveProperty("slug");
  });

  it("keeps long SKUs within 64 characters when suffixed", () => {
    const sku = "S".repeat(64);
    const p = storedProduct({ fulfillment: "stocked", inventory: null, variants: [{ id: "v", sku, options: { a: "b" }, priceToman: 1, inventory: 1, position: 0 }] });
    const variants = duplicateBody(p, 3).variants as Array<{ sku: string }>;
    expect(variants[0]?.sku.length).toBeLessThanOrEqual(64);
  });

  it("moveItem reorders and ignores out-of-range moves", () => {
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], -1, 1)).toEqual([1, 2, 3]);
  });
});

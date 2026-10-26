import { describe, expect, it } from "vitest";
import { demoCategories, demoProducts } from "@/data/demo-catalog";
import { ALL_CATEGORIES, countByCategory, filterByCategory } from "./catalog";

describe("filterByCategory", () => {
  it("returns everything for the all-categories value", () => {
    expect(filterByCategory(demoProducts, ALL_CATEGORIES)).toHaveLength(demoProducts.length);
  });

  it("keeps only products of the requested category", () => {
    const result = filterByCategory(demoProducts, "home-decor");
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.categorySlug === "home-decor")).toBe(true);
  });

  it("returns nothing for an unknown category", () => {
    expect(countByCategory(demoProducts, "nope")).toBe(0);
  });
});

// Guards the project rules: demo data is labelled, never carries invented prices.
describe("demo catalogue integrity", () => {
  it("marks every entry as demo content", () => {
    expect(demoProducts.every((p) => p.isDemo)).toBe(true);
    expect(demoCategories.every((c) => c.isDemo)).toBe(true);
  });

  it("has no invented prices", () => {
    expect(demoProducts.every((p) => p.priceToman === null)).toBe(true);
  });

  it("has unique slugs and valid category references", () => {
    const slugs = demoProducts.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const categories = new Set(demoCategories.map((c) => c.slug));
    expect(demoProducts.every((p) => categories.has(p.categorySlug))).toBe(true);
  });

  it("gives every category at least one product and every product an image", () => {
    expect(demoCategories.every((c) => countByCategory(demoProducts, c.slug) > 0)).toBe(true);
    expect(demoProducts.every((p) => p.images.length > 0)).toBe(true);
  });
});

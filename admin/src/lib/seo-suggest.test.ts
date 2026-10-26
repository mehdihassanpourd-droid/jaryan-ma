import { describe, expect, it } from "vitest";
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from "@/domain/product/schema";
import { emptyForm } from "./product-form";
import { seoHints, suggestSeo } from "./seo-suggest";

describe("SEO suggestions", () => {
  const form = { ...emptyForm(), name: "پرده بافته دستی", price: "۴٬۵۰۰٬۰۰۰", categoryId: "c", description: "توضیح" };

  it("restates only the product's own data", () => {
    const s = suggestSeo(form, "پرده دیواری");
    expect(s.title).toContain("پرده بافته دستی");
    expect(s.description).toContain("۴٬۵۰۰٬۰۰۰");
    expect(s.description).not.toMatch(/امتیاز|نظر|ضمانت|ارسال رایگان/);
  });
  it("ignores the editor's own overrides (it is the automatic text)", () => {
    expect(suggestSeo({ ...form, seoTitle: "دستی" }, null).title).not.toBe("دستی");
  });
  it("stays within the stored limits", () => {
    const s = suggestSeo({ ...form, name: "الف".repeat(110), description: "ب".repeat(1000) }, "ج");
    expect(s.title.length).toBeLessThanOrEqual(SEO_TITLE_MAX + 30);
    expect(s.description.length).toBeLessThanOrEqual(SEO_DESCRIPTION_MAX + 60);
  });
  it("hints advise, never fail: over-long fields and missing alt text are flagged", () => {
    const hints = seoHints("ا".repeat(SEO_TITLE_MAX + 5), "", ["", "x"], 1);
    expect(hints.some((h) => h.level === "warn" && h.text.includes("بلندتر"))).toBe(true);
    expect(hints.some((h) => h.text.includes("متن جایگزین ندارد"))).toBe(true);
    expect(seoHints("", "", [], 0).every((h) => h.level === "ok")).toBe(true);
  });
});

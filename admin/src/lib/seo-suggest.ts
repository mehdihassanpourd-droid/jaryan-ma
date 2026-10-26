import { buildCatalogSeo } from "@/seo/catalog-seo";
import type { SeoProduct } from "@/seo/types";
import type { Availability } from "@/domain/product/snapshot";
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from "@/domain/product/schema";
import { parsePrice, parseWhole } from "./money";
import type { ProductForm } from "./product-form";

export interface SeoSuggestion {
  title: string;
  description: string;
  imageAlts: string[];
}

function inStock(text: string): boolean {
  const n = parseWhole(text, 100_000);
  return n.ok && (n.value ?? 0) > 0;
}

function availability(form: ProductForm): Availability {
  if (form.fulfillment === "made_to_order") return "made_to_order";
  if (form.variants.length > 0) return form.variants.some((v) => inStock(v.inventory)) ? "in_stock" : "sold_out";
  return inStock(form.inventory) ? "in_stock" : "sold_out";
}

/**
 * The text the storefront build would generate for this product, using the SAME code (`src/seo`): nothing is
 * invented, it only restates the product's own name, category, availability, lead time and price. Shown next to the
 * override fields so an editor can accept it, tweak it, or leave the fields empty to keep it automatic.
 */
export function suggestSeo(form: ProductForm, categoryName: string | null): SeoSuggestion {
  const price = parsePrice(form.price);
  const lead = parseWhole(form.leadTimeDays, 365);
  const product: SeoProduct = {
    slug: "preview",
    name: form.name.trim() || "نام محصول",
    description: form.description,
    // The suggestion is what AUTOMATIC generation would produce, so the editor's own overrides are left out.
    seoTitle: null,
    seoDescription: null,
    category: categoryName && form.categoryId ? { slug: form.categoryId, name: categoryName } : null,
    fulfillment: form.fulfillment,
    priceToman: price.ok ? price.value : null,
    availability: availability(form),
    leadTimeDays: lead.ok ? lead.value : null,
    images: form.images.map((i) => ({ url: "", alt: i.alt })),
    variants: form.variants.map((v) => {
      const p = parsePrice(v.price);
      return { sku: v.sku || "-", options: {}, priceToman: p.ok ? p.value : null, available: true };
    }),
    isDemo: false,
  };
  const seo = buildCatalogSeo(
    { source: "snapshot", products: [product], categories: product.category ? [{ ...product.category, isDemo: false }] : [] },
    { origin: null, indexing: false },
    "جریان ما",
  );
  const result = seo.products.get("preview");
  return { title: result?.title ?? "", description: result?.description ?? "", imageAlts: result?.images.map((i) => i.alt) ?? [] };
}

export type Hint = { level: "ok" | "warn"; text: string };

/** Plain-language checks shown under the SEO fields. They advise; they never block saving. */
export function seoHints(title: string, description: string, imageAlts: string[], missingAlt: number): Hint[] {
  const hints: Hint[] = [];
  const t = title.trim().length;
  const d = description.trim().length;
  if (t === 0) hints.push({ level: "ok", text: "عنوان خالی است؛ عنوان خودکار استفاده می‌شود." });
  else if (t > SEO_TITLE_MAX) hints.push({ level: "warn", text: `عنوان ${t - SEO_TITLE_MAX} نویسه بلندتر از حد مجاز است.` });
  else if (t > 60) hints.push({ level: "warn", text: "عنوان بلند است و ممکن است در نتایج جست‌وجو کوتاه نمایش داده شود." });
  else if (t < 15) hints.push({ level: "warn", text: "عنوان کوتاه است؛ نام اثر و نوع آن را بنویسید." });
  else hints.push({ level: "ok", text: "طول عنوان مناسب است." });
  if (d === 0) hints.push({ level: "ok", text: "توضیح خالی است؛ توضیح خودکار استفاده می‌شود." });
  else if (d > SEO_DESCRIPTION_MAX) hints.push({ level: "warn", text: `توضیح ${d - SEO_DESCRIPTION_MAX} نویسه بلندتر از حد مجاز است.` });
  else if (d < 70) hints.push({ level: "warn", text: "توضیح کوتاه است؛ حدود ۷۰ تا ۱۶۰ نویسه مناسب است." });
  else hints.push({ level: "ok", text: "طول توضیح مناسب است." });
  if (missingAlt > 0) hints.push({ level: "warn", text: `${missingAlt} تصویر متن جایگزین ندارد؛ متن خودکار از نام محصول ساخته می‌شود، اما متن توصیفی بهتر است.` });
  else if (imageAlts.length > 0) hints.push({ level: "ok", text: "همه تصاویر متن جایگزین دارند." });
  return hints;
}

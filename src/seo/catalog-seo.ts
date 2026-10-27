import { formatNumber, formatToman } from "@/lib/format";
import { effectiveSettings, type SeoSettings } from "./config";
import { NO_OVERRIDES, type SeoOverrides } from "./overrides-file";
import { cleanText, truncate } from "./text";
import type { SeoCatalog, SeoImage, SeoProduct } from "./types";
import { absoluteImageUrl, absoluteUrl, categoryPath, productPath } from "./urls";

/**
 * Everything a page needs for SEO, derived ONLY from the (validated) catalogue data. No text is invented:
 * titles come from product names, descriptions from the product's own description or from verified facts
 * (category, availability, lead time, price). Computed once for the whole catalogue so uniqueness can be guaranteed.
 */
export interface ImageSeo {
  url: string;
  alt: string;
  placeholder?: SeoImage["placeholder"];
}

export interface ProductSeo {
  slug: string;
  /** Unique across the catalogue. The site name is appended by the layout's title template. */
  title: string;
  /** Unique across the catalogue, at most 160 characters. */
  description: string;
  path: string;
  canonical: string | null;
  /** True only for real (non-sample) products when the site is launched. */
  indexable: boolean;
  images: ImageSeo[];
}

export interface CategorySeo {
  slug: string;
  name: string;
  title: string;
  description: string;
  path: string;
  canonical: string | null;
  indexable: boolean;
  productSlugs: string[];
}

export interface CatalogSeo {
  settings: SeoSettings;
  siteName: string;
  products: Map<string, ProductSeo>;
  categories: Map<string, CategorySeo>;
}

const TITLE_MAX = 70;
const DESCRIPTION_MAX = 160;

/** Alt text: the editor's text when there is any, otherwise a factual label built from the product name. */
export function imageAlt(productName: string, image: SeoImage, index: number, total: number): string {
  const own = cleanText(image.alt);
  if (own) return truncate(own, 200);
  const label = total > 1 ? `${productName} (تصویر ${formatNumber(index + 1)} از ${formatNumber(total)})` : productName;
  return truncate(label, 200);
}

function availabilityPhrase(p: SeoProduct): string {
  if (p.availability === "in_stock") return "موجود";
  if (p.availability === "sold_out") return "ناموجود";
  return p.leadTimeDays ? `ساخت پس از سفارش (زمان ساخت: ${formatNumber(p.leadTimeDays)} روز)` : "ساخت پس از سفارش";
}

/** Lowest price a shopper could pay: the product price, or the cheapest priced variant. */
export function lowestPrice(p: SeoProduct): { amount: number; from: boolean } | null {
  const variantPrices = p.variants.map((v) => v.priceToman).filter((x): x is number => x !== null);
  if (p.priceToman !== null && variantPrices.length === 0) return { amount: p.priceToman, from: false };
  if (variantPrices.length > 0) {
    const min = Math.min(...variantPrices);
    const max = Math.max(...variantPrices);
    return { amount: min, from: min !== max };
  }
  return null;
}

function factsSentence(p: SeoProduct, siteName: string): string {
  // Sample content has no stock, price or lead time of its own: say only that it is a sample.
  if (p.isDemo) return `${p.name} (محتوای نمونه، بدون اطلاعات واقعی) در ${siteName}.`;
  const parts = [`${p.name}${p.category ? ` از دسته ${p.category.name}` : ""} در ${siteName}`, availabilityPhrase(p)];
  const price = lowestPrice(p);
  if (price) parts.push(`${price.from ? "قیمت از" : "قیمت"} ${formatToman(price.amount)}`);
  return `${parts.join("؛ ")}.`;
}

function baseTitle(p: SeoProduct, overrides: SeoOverrides): string {
  // An editor-chosen title wins over an approved repository override, which wins over the generated one (always cleaned and limited; uniqueness is enforced later).
  const chosen = p.seoTitle ? cleanText(p.seoTitle) : (overrides.products[p.slug]?.title ?? "");
  if (chosen) return truncate(chosen, TITLE_MAX);
  const name = cleanText(p.name);
  const category = p.category ? cleanText(p.category.name) : "";
  if (!category || name.includes(category)) return truncate(name, TITLE_MAX);
  const withCategory = `${name} – ${category}`;
  return withCategory.length <= TITLE_MAX ? withCategory : truncate(name, TITLE_MAX);
}

function baseDescription(p: SeoProduct, siteName: string, overrides: SeoOverrides): string {
  const chosen = p.seoDescription ? cleanText(p.seoDescription) : (overrides.products[p.slug]?.description ?? "");
  if (chosen) return truncate(chosen, DESCRIPTION_MAX);
  const own = cleanText(p.description);
  const facts = factsSentence(p, siteName);
  if (own.length >= 80) return truncate(own, DESCRIPTION_MAX);
  if (own.length > 0) return truncate(`${own} ${facts}`, DESCRIPTION_MAX);
  return truncate(facts, DESCRIPTION_MAX);
}

/** Makes every value in the list unique, keeping the first occurrence (slug order) untouched. */
function dedupe<T extends { slug: string }>(items: T[], get: (i: T) => string, set: (i: T, value: string) => void, fix: (value: string, n: number, item: T) => string) {
  const seen = new Map<string, number>();
  for (const item of [...items].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))) {
    const value = get(item);
    const count = (seen.get(value) ?? 0) + 1;
    seen.set(value, count);
    if (count > 1) {
      let candidate = fix(value, count, item);
      let n = count;
      while (seen.has(candidate)) candidate = fix(value, ++n, item);
      seen.set(candidate, 1);
      set(item, candidate);
    }
  }
}

export function buildCatalogSeo(catalog: SeoCatalog, requested: SeoSettings, siteName: string, overrides: SeoOverrides = NO_OVERRIDES): CatalogSeo {
  const settings = effectiveSettings(requested, catalog.source);
  const products = new Map<string, ProductSeo>();
  const mutable = catalog.products.map((p) => {
    const total = p.images.length;
    const seo: ProductSeo = {
      slug: p.slug,
      title: baseTitle(p, overrides),
      description: baseDescription(p, siteName, overrides),
      path: productPath(p.slug),
      canonical: settings.origin ? absoluteUrl(settings.origin, productPath(p.slug)) : null,
      indexable: settings.indexing && !p.isDemo,
      images: p.images.map((img, i) => ({ url: absoluteImageUrl(settings.origin, img.url) ?? "", alt: imageAlt(p.name, img, i, total), placeholder: img.placeholder })),
    };
    products.set(p.slug, seo);
    return seo;
  });

  // Same name (and category) on two products: number the later ones so no two titles are identical.
  dedupe(mutable, (s) => s.title, (s, v) => void (s.title = v), (value, n) => truncate(value, TITLE_MAX - 6) + ` (${formatNumber(n)})`);
  // Copy-pasted descriptions: lead with the (now unique) title.
  dedupe(
    mutable,
    (s) => s.description,
    (s, v) => void (s.description = v),
    (value, n, item) => truncate(`${item.title}. ${value}`, DESCRIPTION_MAX - (n > 2 ? 6 : 0)) + (n > 2 ? ` (${formatNumber(n)})` : ""),
  );

  const categories = new Map<string, CategorySeo>();
  const byCategory = new Map<string, SeoProduct[]>();
  for (const p of catalog.products) if (p.category) byCategory.set(p.category.slug, [...(byCategory.get(p.category.slug) ?? []), p]);
  const catList = new Map(catalog.categories.map((c) => [c.slug, c]));
  for (const p of catalog.products) if (p.category && !catList.has(p.category.slug)) catList.set(p.category.slug, { slug: p.category.slug, name: p.category.name, isDemo: p.isDemo });

  const catSeo = [...catList.values()].map((c) => {
    const inCat = byCategory.get(c.slug) ?? [];
    const indexableCount = inCat.filter((p) => products.get(p.slug)?.indexable).length;
    const seo: CategorySeo = {
      slug: c.slug,
      name: c.name,
      title: truncate(cleanText(c.name), TITLE_MAX),
      description: truncate(`آثار دسته ${cleanText(c.name)} در ${siteName}${inCat.length > 0 ? `: ${formatNumber(inCat.length)} اثر` : ""}.`, DESCRIPTION_MAX),
      path: categoryPath(c.slug),
      canonical: settings.origin ? absoluteUrl(settings.origin, categoryPath(c.slug)) : null,
      indexable: settings.indexing && !c.isDemo && indexableCount > 0,
      productSlugs: inCat.map((p) => p.slug).sort(),
    };
    categories.set(c.slug, seo);
    return seo;
  });
  dedupe(catSeo, (s) => s.title, (s, v) => void (s.title = v), (value, n) => `${value} (${formatNumber(n)})`);

  return { settings, siteName, products, categories };
}

/**
 * Other products of the same category to link from a product page (internal links that keep sold-out pages useful): purchasable ones
 * first, then sold-out, each group in slug order, at most `limit`. Sample content never links to real products or the other way round.
 */
export function relatedProducts(catalog: SeoCatalog, product: SeoProduct, limit = 4): SeoProduct[] {
  if (!product.category) return [];
  const rank = (p: SeoProduct) => (p.availability === "sold_out" ? 1 : 0);
  return catalog.products
    .filter((p) => p.slug !== product.slug && p.isDemo === product.isDemo && p.category?.slug === product.category?.slug)
    .sort((a, b) => rank(a) - rank(b) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, limit);
}

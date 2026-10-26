/**
 * DEMO CONTENT — placeholder data used until the real catalogue is connected
 * to PostgreSQL. Titles are generic on purpose: no real artists, no real
 * prices (every `priceToman` is null), no real photographs.
 * Replace with data from the database (see docs/ARCHITECTURE.md).
 */
import type { CatalogCategory, CatalogProduct } from "@/types/catalog";

export const demoCategories: CatalogCategory[] = [
  { slug: "ceramics", name: "سفال و سرامیک", blurb: "ظرف و دکور دست‌ساز", tone: "sand", isDemo: true },
  { slug: "paintings", name: "نقاشی و تصویر", blurb: "آثار روی بوم و کاغذ", tone: "olive", isDemo: true },
  { slug: "textiles", name: "بافته و پارچه", blurb: "گلیم، پارچه و گره‌چینی", tone: "bark", isDemo: true },
  { slug: "wood", name: "چوب و فلز", blurb: "کنده‌کاری و ساخته‌های دستی", tone: "ivory", isDemo: true },
];

export const demoVendorName = "گالری جریان ما (نمونه)";

export const demoProducts: CatalogProduct[] = [
  {
    slug: "demo-ceramic-bowl",
    title: "کاسه سفالی نمونه",
    categorySlug: "ceramics",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: true,
    images: [
      { tone: "sand", alt: "تصویر نمونه کاسه سفالی، نمای روبه‌رو" },
      { tone: "bark", alt: "تصویر نمونه کاسه سفالی، نمای بالا" },
      { tone: "ivory", alt: "تصویر نمونه کاسه سفالی، جزئیات لبه" },
    ],
    isDemo: true,
  },
  {
    slug: "demo-landscape-painting",
    title: "تابلوی منظره نمونه",
    categorySlug: "paintings",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: true,
    images: [
      { tone: "olive", alt: "تصویر نمونه تابلوی منظره" },
      { tone: "sand", alt: "تصویر نمونه تابلو در قاب" },
    ],
    isDemo: true,
  },
  {
    slug: "demo-woven-runner",
    title: "رانر بافته نمونه",
    categorySlug: "textiles",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: false,
    images: [
      { tone: "bark", alt: "تصویر نمونه رانر بافته" },
      { tone: "ivory", alt: "تصویر نمونه نقش بافت از نزدیک" },
    ],
    isDemo: true,
  },
  {
    slug: "demo-wood-tray",
    title: "سینی چوبی نمونه",
    categorySlug: "wood",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: false,
    images: [
      { tone: "ivory", alt: "تصویر نمونه سینی چوبی" },
      { tone: "bark", alt: "تصویر نمونه بافت چوب" },
    ],
    isDemo: true,
  },
  {
    slug: "demo-ceramic-vase",
    title: "گلدان سرامیکی نمونه",
    categorySlug: "ceramics",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: true,
    images: [
      { tone: "olive", alt: "تصویر نمونه گلدان سرامیکی" },
      { tone: "sand", alt: "تصویر نمونه گلدان، نمای کنار" },
    ],
    isDemo: true,
  },
  {
    slug: "demo-ink-drawing",
    title: "طرح مرکب نمونه",
    categorySlug: "paintings",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: true,
    images: [
      { tone: "sand", alt: "تصویر نمونه طرح مرکب روی کاغذ" },
      { tone: "ivory", alt: "تصویر نمونه طرح با حاشیه" },
    ],
    isDemo: true,
  },
];

export const featuredProducts = demoProducts.slice(0, 4);
export const spotlightProduct = demoProducts[0]!;

export function getCategory(slug: string): CatalogCategory | undefined {
  return demoCategories.find((c) => c.slug === slug);
}

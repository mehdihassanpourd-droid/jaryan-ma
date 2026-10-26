/**
 * DEMO CONTENT — placeholder data used until the real catalogue is connected
 * to PostgreSQL. Titles are generic on purpose: no real artists, no real
 * prices (every `priceToman` is null), no real photographs. Category names are
 * proposals pending the gallery's confirmation.
 * Replace with data from the database (see ARCHITECTURE.md).
 */
import type { CatalogCategory, CatalogProduct } from "@/types/catalog";

export const demoCategories: CatalogCategory[] = [
  { slug: "wall-hangings", name: "دیوارکوب بافته", blurb: "بافته‌های آویز برای دیوار", tone: "sand", motif: "fringe", isDemo: true },
  { slug: "macrame", name: "ماکرومه", blurb: "گره‌چینی و ریشه‌دوزی", tone: "ivory", motif: "arch", isDemo: true },
  { slug: "woven-panels", name: "تابلوی بافته", blurb: "نقش و بافت قاب‌شده", tone: "olive", motif: "diamond", isDemo: true },
  { slug: "home-decor", name: "دکور و منسوجات خانه", blurb: "رانر، کوسن و جزئیات خانه", tone: "bark", motif: "stripes", isDemo: true },
];

export const demoVendorName = "گالری جریان ما (نمونه)";

export const demoProducts: CatalogProduct[] = [
  {
    slug: "demo-wall-hanging",
    title: "دیوارکوب بافته نمونه",
    categorySlug: "wall-hangings",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: true,
    images: [
      { tone: "sand", motif: "fringe", alt: "تصویر نمونه دیوارکوب بافته با ریشه، نمای روبه‌رو" },
      { tone: "bark", motif: "detail", alt: "تصویر نمونه بافت دیوارکوب از نزدیک" },
      { tone: "ivory", motif: "fringe", alt: "تصویر نمونه دیوارکوب در رنگ روشن" },
    ],
    isDemo: true,
  },
  {
    slug: "demo-arch-macrame",
    title: "ماکرومه قوسی نمونه",
    categorySlug: "macrame",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: true,
    images: [
      { tone: "ivory", motif: "arch", alt: "تصویر نمونه ماکرومه قوسی" },
      { tone: "sand", motif: "detail", alt: "تصویر نمونه گره‌ها از نزدیک" },
    ],
    isDemo: true,
  },
  {
    slug: "demo-diamond-panel",
    title: "تابلوی بافته لوزی‌نقش نمونه",
    categorySlug: "woven-panels",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: true,
    images: [
      { tone: "olive", motif: "diamond", alt: "تصویر نمونه تابلوی بافته با نقش لوزی" },
      { tone: "sand", motif: "detail", alt: "تصویر نمونه بافت تابلو از نزدیک" },
    ],
    isDemo: true,
  },
  {
    slug: "demo-woven-runner",
    title: "رانر بافته نمونه",
    categorySlug: "home-decor",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: false,
    images: [
      { tone: "bark", motif: "stripes", alt: "تصویر نمونه رانر راه‌راه بافته" },
      { tone: "ivory", motif: "detail", alt: "تصویر نمونه بافت رانر از نزدیک" },
    ],
    isDemo: true,
  },
  {
    slug: "demo-fringe-hanging",
    title: "دیوارکوب ریشه‌دار نمونه",
    categorySlug: "wall-hangings",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: true,
    images: [
      { tone: "olive", motif: "fringe", alt: "تصویر نمونه دیوارکوب ریشه‌دار سبز" },
      { tone: "bark", motif: "fringe", alt: "تصویر نمونه دیوارکوب ریشه‌دار قهوه‌ای" },
    ],
    isDemo: true,
  },
  {
    slug: "demo-cushion",
    title: "کوسن بافته نمونه",
    categorySlug: "home-decor",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: false,
    images: [
      { tone: "sand", motif: "diamond", alt: "تصویر نمونه کوسن بافته" },
      { tone: "olive", motif: "detail", alt: "تصویر نمونه بافت کوسن از نزدیک" },
    ],
    isDemo: true,
  },
];

export const featuredProducts = demoProducts;
export const spotlightProduct = demoProducts[0]!;

export function getCategory(slug: string): CatalogCategory | undefined {
  return demoCategories.find((c) => c.slug === slug);
}

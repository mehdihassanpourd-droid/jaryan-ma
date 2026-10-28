/**
 * DEMO CONTENT — placeholder data used until the real catalogue is connected
 * to PostgreSQL. Titles are generic on purpose: no real artists, no real
 * prices (every `priceToman` is null), no real photographs (the images are
 * labelled sample illustrations). The three categories are the gallery's
 * current ones (hand-painted fabric tote bags, crochet mandala wall art,
 * handmade pottery and ceramics); their exact names await the gallery's confirmation.
 * Replace with data from the database (see ARCHITECTURE.md).
 */
import type { CatalogCategory, CatalogProduct } from "@/types/catalog";

export const demoCategories: CatalogCategory[] = [
  { slug: "tote-bags", name: "کیف پارچه‌ای نقاشی‌دست", blurb: "کیف‌های پارچه‌ای نقاشی‌شده با دست", art: "tote-1", isDemo: true },
  { slug: "mandala-wall-art", name: "ماندالای قلاب‌بافی", blurb: "دیوارکوب‌های قلاب‌بافی‌شده", art: "mandala-1", isDemo: true },
  { slug: "ceramics", name: "سفال و سرامیک", blurb: "سفال و سرامیک دست‌ساز", art: "vase-1", isDemo: true },
];

export const demoVendorName = "گالری جریان ما (نمونه)";

export const demoProducts: CatalogProduct[] = [
  {
    slug: "demo-floral-tote",
    title: "کیف پارچه‌ای گل‌دار نمونه",
    categorySlug: "tote-bags",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: true,
    images: [
      { art: "tote-1", alt: "تصویر نمونه کیف پارچه‌ای با نقاشی گل، نمای روبه‌رو" },
      { art: "studio-1", alt: "تصویر نمونه میز کار با قلم‌مو و رنگ" },
    ],
    isDemo: true,
  },
  {
    slug: "demo-mandala-sunburst",
    title: "ماندالای قلاب‌بافی خورشیدی نمونه",
    categorySlug: "mandala-wall-art",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: true,
    images: [
      { art: "mandala-1", alt: "تصویر نمونه ماندالای قلاب‌بافی با ریشه" },
      { art: "mandala-3", alt: "تصویر نمونه ماندالا در رنگ‌های خاکی" },
    ],
    isDemo: true,
  },
  {
    slug: "demo-blue-vase",
    title: "گلدان سفالی آبی نمونه",
    categorySlug: "ceramics",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: true,
    images: [
      { art: "vase-1", alt: "تصویر نمونه گلدان سفالی آبی با گل" },
      { art: "vase-2", alt: "تصویر نمونه سفال‌ها روی قفسه" },
      { art: "studio-2", alt: "تصویر نمونه کارگاه سفالگری" },
    ],
    isDemo: true,
  },
  {
    slug: "demo-patterned-tote",
    title: "کیف پارچه‌ای طرح‌دار نمونه",
    categorySlug: "tote-bags",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: false,
    images: [
      { art: "tote-2", alt: "تصویر نمونه کیف پارچه‌ای با طرح گل‌های پراکنده" },
      { art: "tote-3", alt: "تصویر نمونه کیف پارچه‌ای با طرح قوس‌ها" },
    ],
    isDemo: true,
  },
  {
    slug: "demo-mandala-night",
    title: "ماندالای قلاب‌بافی شب نمونه",
    categorySlug: "mandala-wall-art",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: true,
    images: [{ art: "mandala-2", alt: "تصویر نمونه ماندالا روی زمینهٔ سبز تیره" }],
    isDemo: true,
  },
  {
    slug: "demo-ceramic-set",
    title: "ست سفالی نمونه",
    categorySlug: "ceramics",
    vendorName: demoVendorName,
    priceToman: null,
    isUnique: false,
    images: [
      { art: "vase-3", alt: "تصویر نمونه سه ظرف سفالی" },
      { art: "vase-2", alt: "تصویر نمونه کاسه و لیوان سفالی" },
    ],
    isDemo: true,
  },
];

export const featuredProducts = demoProducts;

export function getCategory(slug: string): CatalogCategory | undefined {
  return demoCategories.find((c) => c.slug === slug);
}

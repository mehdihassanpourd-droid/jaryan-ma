import type { SeoCatalog, SeoProduct } from "./types";

/** Test helpers: a small REAL-looking catalogue in the shape the backend publishes. Not used by the site. */
export function product(over: Partial<SeoProduct> = {}): SeoProduct {
  return {
    slug: "دیوارکوب-بافته-پاییزی",
    name: "دیوارکوب بافته پاییزی",
    description: "",
    category: { slug: "دیوارکوب", name: "دیوارکوب" },
    fulfillment: "unique",
    priceToman: 4_500_000,
    availability: "in_stock",
    leadTimeDays: null,
    images: [{ url: "https://media.example.ir/images/p1/a.webp", alt: "دیوارکوب پاییزی با ریشه‌های بلند" }],
    variants: [],
    isDemo: false,
    ...over,
  };
}

export function catalog(products: SeoProduct[], source: SeoCatalog["source"] = "snapshot"): SeoCatalog {
  const seen = new Map<string, { slug: string; name: string; isDemo: boolean }>();
  for (const p of products) if (p.category) seen.set(p.category.slug, { ...p.category, isDemo: p.isDemo });
  return { source, products, categories: [...seen.values()] };
}

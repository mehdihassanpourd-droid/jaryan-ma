import { absoluteImageUrl } from "./urls";
import { lowestPrice, type CatalogSeo } from "./catalog-seo";
import type { SeoProduct } from "./types";

type Json = Record<string, unknown>;

const AVAILABILITY: Record<SeoProduct["availability"], string> = {
  in_stock: "https://schema.org/InStock",
  sold_out: "https://schema.org/OutOfStock",
  made_to_order: "https://schema.org/MadeToOrder",
};

/**
 * schema.org needs an ISO 4217 currency, and Toman is not one: the price is stated in Rial (1 Toman = 10 Rial).
 * Computed in BigInt and emitted as a string, because 10^15 Toman = 10^16 Rial is beyond 2^53 for a JSON number.
 */
export function tomanToRialString(toman: number): string {
  return (BigInt(toman) * 10n).toString();
}

function offers(p: SeoProduct, url: string): Json | undefined {
  const prices = p.variants.map((v) => v.priceToman).filter((x): x is number => x !== null);
  const availability = AVAILABILITY[p.availability];
  if (prices.length >= 2 && Math.min(...prices) !== Math.max(...prices)) {
    return {
      "@type": "AggregateOffer",
      priceCurrency: "IRR",
      lowPrice: tomanToRialString(Math.min(...prices)),
      highPrice: tomanToRialString(Math.max(...prices)),
      offerCount: p.variants.length,
      availability,
      url,
    };
  }
  const price = lowestPrice(p);
  // No announced price = no offer at all. Never "price on request", never a made-up number.
  if (!price) return undefined;
  return { "@type": "Offer", priceCurrency: "IRR", price: tomanToRialString(price.amount), availability, url };
}

/**
 * schema.org/Product for a REAL product, or null when it must not be described that way
 * (sample content, or no known origin to build absolute URLs from). No ratings, reviews, brand, GTIN,
 * shipping or return policy: none of that exists in the data.
 */
export function productJsonLd(p: SeoProduct, seo: CatalogSeo): Json | null {
  const meta = seo.products.get(p.slug);
  const origin = seo.settings.origin;
  if (!meta || p.isDemo || !origin || !meta.canonical) return null;
  const images = p.images.map((i) => absoluteImageUrl(origin, i.url)).filter((x): x is string => x !== null && x !== "");
  const offer = offers(p, meta.canonical);
  const description = p.description.trim() ? meta.description : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${meta.canonical}#product`,
    url: meta.canonical,
    name: p.name,
    ...(description ? { description } : {}),
    ...(images.length > 0 ? { image: images } : {}),
    ...(p.category ? { category: p.category.name } : {}),
    ...(p.variants.length === 1 && p.variants[0] ? { sku: p.variants[0].sku } : {}),
    ...(offer ? { offers: offer } : {}),
  };
}

export function breadcrumbJsonLd(p: SeoProduct, seo: CatalogSeo): Json | null {
  const origin = seo.settings.origin;
  const meta = seo.products.get(p.slug);
  if (!origin || !meta?.canonical || p.isDemo) return null;
  const category = p.category ? seo.categories.get(p.category.slug) : undefined;
  const trail: Array<{ name: string; item: string }> = [{ name: "خانه", item: `${origin}/` }];
  if (category?.canonical) trail.push({ name: category.name, item: category.canonical });
  trail.push({ name: p.name, item: meta.canonical });
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: t.item })),
  };
}

export function categoryBreadcrumbJsonLd(categorySlug: string, seo: CatalogSeo): Json | null {
  const origin = seo.settings.origin;
  const category = seo.categories.get(categorySlug);
  if (!origin || !category?.canonical || !category.indexable) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "خانه", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: category.name, item: category.canonical },
    ],
  };
}

/**
 * The category as a CollectionPage whose main entity lists its indexable products (name + canonical URL, in a stable order):
 * a crawlable map of the collection. Only facts that exist in the data; nothing for sample content.
 */
export function categoryCollectionJsonLd(categorySlug: string, seo: CatalogSeo): Json | null {
  const category = seo.categories.get(categorySlug);
  if (!category?.canonical || !category.indexable) return null;
  const items = category.productSlugs.map((s) => seo.products.get(s)).filter((p): p is NonNullable<typeof p> => Boolean(p?.indexable && p.canonical));
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${category.canonical}#collection`,
    url: category.canonical,
    name: category.name,
    inLanguage: "fa-IR",
    mainEntity: { "@type": "ItemList", numberOfItems: items.length, itemListElement: items.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: p.canonical, name: p.title })) },
  };
}

/** The organisation and website, from the only confirmed facts: brand name and Instagram account. */
export function siteJsonLd(origin: string | null, name: string, instagramUrl: string): Json[] {
  if (!origin) return [];
  return [
    { "@context": "https://schema.org", "@type": "Organization", "@id": `${origin}/#organization`, name, url: `${origin}/`, sameAs: [instagramUrl] },
    { "@context": "https://schema.org", "@type": "WebSite", "@id": `${origin}/#website`, name, url: `${origin}/`, inLanguage: "fa-IR", publisher: { "@id": `${origin}/#organization` } },
  ];
}

/** Safe to place inside a <script> element: `<`, `>`, `&` and line separators can never end or alter the script. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .split(String.fromCharCode(0x2028))
    .join("\\u2028")
    .split(String.fromCharCode(0x2029))
    .join("\\u2029");
}

import type { MetadataRoute } from "next";
import { absoluteUrl } from "./urls";
import type { CatalogSeo } from "./catalog-seo";

/**
 * Every indexable URL, generated from the catalogue: the home page, categories that have indexable products,
 * and each real product. Sample content never appears. `lastModified` is deliberately omitted: the public
 * snapshots carry no edit time, and a made-up date is worse than none. Sorted for stable output.
 */
export function buildSitemap(seo: CatalogSeo): MetadataRoute.Sitemap {
  const origin = seo.settings.origin;
  // Closed (pre-launch, or no real catalogue): robots.txt disallows everything, so a sitemap would contradict it.
  if (!origin || !seo.settings.indexing) return [];
  const urls = [
    absoluteUrl(origin, "/"),
    ...[...seo.categories.values()].filter((c) => c.indexable && c.canonical).map((c) => c.canonical as string),
    ...[...seo.products.values()].filter((p) => p.indexable && p.canonical).map((p) => p.canonical as string),
  ];
  return [...new Set(urls)].sort().map((url) => ({ url }));
}

/** `/product?` (the live, script-rendered product page) is not `/products/…` (the real pages): the question mark keeps them apart. */
export const PRIVATE_PATHS = ["/cart", "/checkout", "/order", "/orders", "/product?", "/api/"];

/** robots.txt: closed (as today's demo) unless the owner has launched the site. */
export function buildRobots(origin: string | null, indexing: boolean): MetadataRoute.Robots {
  if (!indexing || !origin) return { rules: { userAgent: "*", disallow: "/" } };
  // Launched: everything public may be crawled, the private shopping pages (cart, checkout, orders, the live product page that
  // only exists to add to the cart) and the API may not: they carry no content of their own and must never compete with real pages.
  return { rules: { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS }, sitemap: absoluteUrl(origin, "/sitemap.xml") };
}

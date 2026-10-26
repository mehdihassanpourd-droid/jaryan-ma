import type { MetadataRoute } from "next";
import { loadSeo } from "@/seo";
import { buildRobots } from "@/seo/sitemap";

export const dynamic = "force-static";

/**
 * Closed to crawlers (as the demo has always been) until the site is launched: SEO_ALLOW_INDEXING=true, a known
 * origin AND a real catalogue (see `effectiveSettings`).
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const { seo } = await loadSeo();
  return buildRobots(seo.settings.origin, seo.settings.indexing);
}

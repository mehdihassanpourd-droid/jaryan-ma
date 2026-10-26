import type { MetadataRoute } from "next";
import { seoSettings } from "@/seo/config";
import { buildRobots } from "@/seo/sitemap";

export const dynamic = "force-static";

/** Closed to crawlers (as the demo has always been) until SEO_ALLOW_INDEXING=true is set for a real, launched site. */
export default function robots(): MetadataRoute.Robots {
  const { origin, indexing } = seoSettings();
  return buildRobots(origin, indexing);
}

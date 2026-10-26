import type { MetadataRoute } from "next";
import { loadSeo } from "@/seo";
import { buildSitemap } from "@/seo/sitemap";

export const dynamic = "force-static";

/** Generated at build time from the verified catalogue: real products only, never sample content. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { seo } = await loadSeo();
  return buildSitemap(seo);
}

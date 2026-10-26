import { site } from "@/lib/site";
import { buildCatalogSeo, type CatalogSeo } from "./catalog-seo";
import { loadSeoCatalog } from "./catalog-source";
import { seoSettings } from "./config";
import type { SeoCatalog } from "./types";

export interface LoadedSeo {
  catalog: SeoCatalog;
  seo: CatalogSeo;
}

let cached: Promise<LoadedSeo> | null = null;

/** The catalogue and everything derived from it, computed once per build process. */
export function loadSeo(): Promise<LoadedSeo> {
  cached ??= loadSeoCatalog().then((catalog) => ({ catalog, seo: buildCatalogSeo(catalog, seoSettings(), site.name) }));
  return cached;
}

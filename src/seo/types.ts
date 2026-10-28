import type { PublicImage, PublicProduct } from "@/domain/product/snapshot";
import type { SampleArt } from "@/types/catalog";

/** A product image. Sample content has no photograph yet, so it carries the placeholder artwork instead of a URL. */
export interface SeoImage extends PublicImage {
  placeholder?: { art: SampleArt };
}

/**
 * A product as the SEO layer sees it: exactly the public snapshot shape the PostgreSQL backend publishes,
 * plus whether it is sample content. Nothing else is ever used to describe a product.
 */
export interface SeoProduct extends Omit<PublicProduct, "images"> {
  images: SeoImage[];
  /** Sample content is never indexable and never gets product structured data. */
  isDemo: boolean;
}

export interface SeoCategory {
  slug: string;
  name: string;
  isDemo: boolean;
}

export interface SeoCatalog {
  /** `snapshot` = real published catalogue; `demo` = built-in sample content (no real catalogue connected). */
  source: "demo" | "snapshot";
  products: SeoProduct[];
  categories: SeoCategory[];
}

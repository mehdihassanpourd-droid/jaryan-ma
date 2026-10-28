/**
 * Sample illustration drawn by `scripts/design/make-sample-art.mjs` (public/sample/<id>.svg). They stand in for product
 * photography until real photos exist, and are always shown with a "تصویر موقت" label.
 */
export type SampleArt =
  | "tote-1"
  | "tote-2"
  | "tote-3"
  | "mandala-1"
  | "mandala-2"
  | "mandala-3"
  | "vase-1"
  | "vase-2"
  | "vase-3"
  | "studio-1"
  | "studio-2"
  | "artist-1"
  | "artist-2"
  | "artist-3";

export interface CatalogImage {
  art: SampleArt;
  alt: string;
}

export interface CatalogCategory {
  slug: string;
  name: string;
  blurb: string;
  /** Cover illustration while the category is sample content. */
  art: SampleArt;
  /** True while the entry is sample content, not real catalogue data. */
  isDemo: boolean;
}

/** Mirrors the Prisma `Product` model (plus resolved relations) for the UI layer. */
export interface CatalogProduct {
  slug: string;
  title: string;
  categorySlug: string;
  vendorName: string;
  /** Integer Toman; `null` means "price not announced". */
  priceToman: number | null;
  isUnique: boolean;
  images: CatalogImage[];
  isDemo: boolean;
}

/**
 * A curated artist (future). Nothing in the catalogue carries one yet: the layout reads this optional shape so artist
 * profiles can be added without redesigning pages. Never filled with invented people.
 */
export interface ArtistProfile {
  slug: string;
  name: string;
  /** Portrait or work photo URL; absent = a labelled placeholder is drawn instead. */
  imageUrl?: string;
  statement?: string;
}

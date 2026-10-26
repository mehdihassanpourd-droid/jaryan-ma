/** Colour tone used by the placeholder artwork (no real photography yet). */
export type Tone = "ivory" | "sand" | "bark" | "olive";

/** Abstract woven-art motif drawn by `ArtPlaceholder`. */
export type Motif = "fringe" | "arch" | "diamond" | "stripes" | "waves" | "detail";

export interface CatalogImage {
  tone: Tone;
  motif: Motif;
  alt: string;
}

export interface CatalogCategory {
  slug: string;
  name: string;
  blurb: string;
  tone: Tone;
  motif: Motif;
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

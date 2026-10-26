import type { CatalogProduct } from "@/types/catalog";

export const ALL_CATEGORIES = "all";

/** Products in one category, or all of them for `ALL_CATEGORIES`. */
export function filterByCategory(products: CatalogProduct[], categorySlug: string): CatalogProduct[] {
  if (categorySlug === ALL_CATEGORIES) return products;
  return products.filter((p) => p.categorySlug === categorySlug);
}

export function countByCategory(products: CatalogProduct[], categorySlug: string): number {
  return filterByCategory(products, categorySlug).length;
}

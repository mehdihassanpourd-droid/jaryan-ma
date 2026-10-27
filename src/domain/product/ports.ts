import type { ProductListQuery } from "./query";
import type { ImportProductInput, ProductInput } from "./schema";
import type { ProductListRow, ProductStatus, StoredProduct } from "./types";

/**
 * Ports: what the application needs from persistence and object storage, independent of any
 * vendor. Production uses PostgreSQL + Prisma and an S3-compatible bucket; development and tests
 * use embedded/in-memory implementations. Implementations throw the domain errors from
 * `../errors` (ConflictError, NotFoundError) so callers never depend on driver error types.
 */

export interface ProductPage {
  items: ProductListRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CategoryRecord {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  position: number;
}

export interface ImportOutcome {
  created: number;
  updated: number;
  affected: Array<{ id: string; previousCategoryId: string | null }>;
}

export interface ProductSummary {
  id: string;
  slug: string;
  status: ProductStatus;
  categoryId: string | null;
}

export interface CatalogRepository {
  slugExists(slug: string): Promise<boolean>;
  listProducts(query: ProductListQuery, forceStatus?: readonly ProductStatus[]): Promise<ProductPage>;
  getProduct(id: string): Promise<StoredProduct | null>;
  /** At most 100 ids per call. */
  getProducts(ids: string[]): Promise<StoredProduct[]>;
  /** PUBLISHED products only, by slug (checkout reads prices and stock here). At most 100 slugs per call. */
  getPublishedBySlugs(slugs: string[]): Promise<StoredProduct[]>;
  getSummary(id: string): Promise<ProductSummary | null>;

  /** `input.slug` must already be resolved and unique-checked by the caller; the store still enforces it. */
  createProduct(input: ProductInput & { slug: string }, actor: string): Promise<StoredProduct>;
  /** `expectedVersion = null` overwrites regardless of version (bulk import only). */
  updateProduct(id: string, input: ProductInput, expectedVersion: number | null, actor: string): Promise<StoredProduct>;
  /** Upsert by slug, all-or-nothing. */
  importProducts(inputs: ImportProductInput[], actor: string): Promise<ImportOutcome>;
  /** Appends an image row; false when the product already has `max` images. */
  addImage(productId: string, key: string, alt: string, max: number, actor: string): Promise<boolean>;

  listCategories(): Promise<CategoryRecord[]>;
  listCategoryCounts(): Promise<Array<CategoryRecord & { publishedCount: number }>>;
  createCategory(input: { slug: string; name: string; parentId?: string | null }): Promise<CategoryRecord>;
  /** Published products of one category, newest first (snapshot cards). */
  listPublishedRows(categoryId: string, limit: number): Promise<ProductListRow[]>;
}

export interface ObjectStorage {
  put(key: string, body: Uint8Array | string, options: { contentType: string; cacheControl?: string }): Promise<void>;
  delete(keys: string[]): Promise<void>;
}

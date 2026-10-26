import { ConflictError, NotFoundError, ValidationError } from "../../src/domain/errors";
import { slugify } from "../../src/domain/persian";
import type { CatalogRepository, ImportOutcome } from "../../src/domain/product/ports";
import type { ProductListQuery } from "../../src/domain/product/query";
import { validateProductInput, type ImportProductInput, type ProductInput } from "../../src/domain/product/schema";
import type { ProductStatus, StoredProduct } from "../../src/domain/product/types";

/**
 * Business rules that must hold for every database: slug resolution and publish validation.
 * Depends only on the `CatalogRepository` port.
 */
export class CatalogService {
  constructor(readonly repo: CatalogRepository) {}

  list(query: ProductListQuery) {
    return this.repo.listProducts(query);
  }

  get(id: string) {
    return this.repo.getProduct(id);
  }

  /** Explicit slugs must be free (409 otherwise); generated ones are made unique. */
  async create(input: ProductInput, actor: string): Promise<StoredProduct> {
    if (input.slug) {
      if (await this.repo.slugExists(input.slug)) throw new ConflictError("slug_taken");
      return this.repo.createProduct({ ...input, slug: input.slug }, actor);
    }
    const base = slugify(input.name) || `product-${crypto.randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 10; i++) {
      const slug = i === 0 ? base : `${base}-${i + 1}`;
      if (await this.repo.slugExists(slug)) continue;
      try {
        return await this.repo.createProduct({ ...input, slug }, actor);
      } catch (error) {
        if (!(error instanceof ConflictError && error.code === "slug_taken")) throw error; // lost a race: try the next suffix
      }
    }
    return this.repo.createProduct({ ...input, slug: `${base}-${crypto.randomUUID().slice(0, 6)}` }, actor);
  }

  update(id: string, input: ProductInput, expectedVersion: number, actor: string) {
    return this.repo.updateProduct(id, input, expectedVersion, actor);
  }

  /** Re-validates the whole product with the new status (publishing has extra requirements). */
  async setStatus(id: string, status: ProductStatus, expectedVersion: number, actor: string): Promise<StoredProduct> {
    const current = await this.repo.getProduct(id);
    if (!current) throw new NotFoundError();
    const result = validateProductInput({
      slug: current.slug,
      name: current.name,
      description: current.description,
      categoryId: current.categoryId,
      status,
      fulfillment: current.fulfillment,
      priceToman: current.priceToman,
      inventory: current.inventory,
      leadTimeDays: current.leadTimeDays,
      images: current.images.map((i) => ({ key: i.key, alt: i.alt })),
      variants: current.variants.map((v) => ({ sku: v.sku, options: v.options, priceToman: v.priceToman, inventory: v.inventory })),
    });
    if (!result.ok) throw new ValidationError(result.issues);
    return this.repo.updateProduct(id, result.value, expectedVersion, actor);
  }

  importChunk(inputs: ImportProductInput[], actor: string): Promise<ImportOutcome> {
    return this.repo.importProducts(inputs, actor);
  }
}

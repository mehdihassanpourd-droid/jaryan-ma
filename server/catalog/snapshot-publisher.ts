import {
  SNAPSHOT_PATHS,
  serializeSnapshot,
  toPublicCard,
  toPublicProduct,
  type Manifest,
  type SnapshotContext,
} from "../../src/domain/product/snapshot";
import type { CatalogRepository, ObjectStorage } from "../../src/domain/product/ports";

/**
 * Publishes the public catalogue snapshots to the object store (S3-compatible in production).
 * The static storefront reads these files from a CDN/bucket, so shoppers never touch the database
 * or this server. Only published products are written; unpublished/archived ones are deleted.
 */
export interface SyncTarget {
  id: string;
  /** Slug / category before the change, so stale files and shards are cleaned up. */
  previousSlug?: string | null;
  previousCategoryId?: string | null;
}

export interface SyncOptions {
  /**
   * false = only write/delete per-product files and skip category shards and the manifest.
   * Used by chunked imports so shards are rebuilt once at the end, not once per chunk.
   */
  rebuildIndexes?: boolean;
}

const JSON_TYPE = "application/json; charset=utf-8";
const CACHE_ITEM = "public, max-age=60, stale-while-revalidate=3600";
const CACHE_MANIFEST = "public, max-age=30";
const SHARD_LIMIT = 1000;

export class SnapshotPublisher {
  constructor(
    private readonly repo: CatalogRepository,
    private readonly storage: ObjectStorage,
    private readonly publicMediaUrl: string,
    private readonly clock: () => number = Date.now,
  ) {}

  private put(key: string, value: unknown, cacheControl: string) {
    return this.storage.put(key, serializeSnapshot(value), { contentType: JSON_TYPE, cacheControl });
  }

  private async context(): Promise<SnapshotContext> {
    const categories = await this.repo.listCategories();
    return {
      imageBaseUrl: this.publicMediaUrl,
      categoryById: new Map(categories.map((c) => [c.id, { slug: c.slug, name: c.name }])),
    };
  }

  private async rebuildShards(categoryIds: Iterable<string>, ctx: SnapshotContext) {
    for (const categoryId of new Set(categoryIds)) {
      const category = ctx.categoryById.get(categoryId);
      if (!category) continue;
      const rows = await this.repo.listPublishedRows(categoryId, SHARD_LIMIT);
      await this.put(SNAPSHOT_PATHS.category(category.slug), { category, products: rows.map((r) => toPublicCard(r, ctx)) }, CACHE_ITEM);
    }
  }

  async rebuildManifest(): Promise<Manifest> {
    const counts = await this.repo.listCategoryCounts();
    const manifest: Manifest = {
      version: this.clock(),
      categories: counts.map((c) => ({ slug: c.slug, name: c.name, count: c.publishedCount, shard: SNAPSHOT_PATHS.category(c.slug) })),
    };
    await this.put(SNAPSHOT_PATHS.manifest, manifest, CACHE_MANIFEST);
    return manifest;
  }

  async sync(targets: SyncTarget[], options: SyncOptions = {}): Promise<void> {
    if (targets.length === 0) return;
    const ctx = await this.context();
    const affectedCategories = new Set<string>();

    for (let i = 0; i < targets.length; i += 100) {
      const chunk = targets.slice(i, i + 100);
      const products = new Map((await this.repo.getProducts(chunk.map((t) => t.id))).map((p) => [p.id, p]));
      for (const target of chunk) {
        const product = products.get(target.id);
        if (target.previousCategoryId) affectedCategories.add(target.previousCategoryId);
        if (product?.categoryId) affectedCategories.add(product.categoryId);

        // Files to remove: every known slug of a product that is no longer public, or a previous slug after a rename.
        const stale = new Set<string>();
        if (product?.status === "published") {
          if (target.previousSlug && target.previousSlug !== product.slug) stale.add(target.previousSlug);
        } else {
          if (product) stale.add(product.slug);
          if (target.previousSlug) stale.add(target.previousSlug);
        }
        if (stale.size > 0) await this.storage.delete([...stale].map((slug) => SNAPSHOT_PATHS.product(slug)));

        if (product?.status === "published") {
          await this.put(SNAPSHOT_PATHS.product(product.slug), toPublicProduct(product, ctx), CACHE_ITEM);
        }
      }
    }
    if (options.rebuildIndexes === false) return;
    await this.rebuildShards(affectedCategories, ctx);
    await this.rebuildManifest();
  }

  /** Repair tool: rebuilds one category shard (or all) and the manifest from the database. */
  async resync(categoryId?: string): Promise<void> {
    const ctx = await this.context();
    await this.rebuildShards(categoryId ? [categoryId] : ctx.categoryById.keys(), ctx);
    await this.rebuildManifest();
  }
}

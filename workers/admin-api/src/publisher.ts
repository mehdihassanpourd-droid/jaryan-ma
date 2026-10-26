import {
  SNAPSHOT_PATHS,
  serializeSnapshot,
  toPublicCard,
  toPublicProduct,
  type Manifest,
  type SnapshotContext,
} from "../../../src/domain/product/snapshot";
import type { Env } from "./env";
import { getProductsByIds, listCategories, listCategoriesWithCounts, listPublishedRows } from "./repository";

/**
 * Writes the public catalogue snapshots to the bucket after admin changes. The static
 * storefront reads these files from the CDN, so shoppers never touch D1 or this Worker.
 * Only published products are ever written; unpublished/archived ones are deleted.
 */
export interface SyncTarget {
  id: string;
  /** Slug / category before the change, so old files and shards are cleaned up. */
  previousSlug?: string | null;
  previousCategoryId?: string | null;
}

const JSON_TYPE = "application/json; charset=utf-8";
const CACHE_ITEM = "public, max-age=60, stale-while-revalidate=3600";
const CACHE_MANIFEST = "public, max-age=30";

const put = (env: Env, key: string, value: unknown, cacheControl: string) =>
  env.BUCKET.put(key, serializeSnapshot(value), { httpMetadata: { contentType: JSON_TYPE, cacheControl } });

async function buildContext(env: Env): Promise<{ ctx: SnapshotContext; categories: Awaited<ReturnType<typeof listCategories>> }> {
  const categories = await listCategories(env.DB);
  return {
    categories,
    ctx: {
      imageBaseUrl: env.PUBLIC_BUCKET_URL ?? "",
      categoryById: new Map(categories.map((c) => [c.id, { slug: c.slug, name: c.name }])),
    },
  };
}

async function rebuildShards(env: Env, categoryIds: Iterable<string>, ctx: SnapshotContext) {
  for (const categoryId of new Set(categoryIds)) {
    const category = ctx.categoryById.get(categoryId);
    if (!category) continue;
    const rows = await listPublishedRows(env.DB, categoryId);
    await put(env, SNAPSHOT_PATHS.category(category.slug), { category, products: rows.map((r) => toPublicCard(r, ctx)) }, CACHE_ITEM);
  }
}

export async function rebuildManifest(env: Env): Promise<Manifest> {
  const counts = await listCategoriesWithCounts(env.DB);
  const manifest: Manifest = {
    version: Date.now(),
    categories: counts.map((c) => ({ slug: c.slug, name: c.name, count: c.count, shard: SNAPSHOT_PATHS.category(c.slug) })),
  };
  await put(env, SNAPSHOT_PATHS.manifest, manifest, CACHE_MANIFEST);
  return manifest;
}

export interface SyncOptions {
  /**
   * false = only write/delete the per-product files and skip category shards and the manifest.
   * Used by chunked imports so shards are rebuilt once at the end (POST /catalog/resync),
   * not once per chunk (D1 "rows read" is metered).
   */
  rebuildIndexes?: boolean;
}

export async function syncCatalog(env: Env, targets: SyncTarget[], options: SyncOptions = {}): Promise<void> {
  if (targets.length === 0) return;
  const { ctx } = await buildContext(env);
  const affectedCategories = new Set<string>();

  for (let i = 0; i < targets.length; i += 90) {
    const chunk = targets.slice(i, i + 90);
    const products = new Map((await getProductsByIds(env.DB, chunk.map((t) => t.id))).map((p) => [p.id, p]));
    for (const target of chunk) {
      const product = products.get(target.id);
      if (target.previousCategoryId) affectedCategories.add(target.previousCategoryId);
      if (product?.categoryId) affectedCategories.add(product.categoryId);

      // Files to remove: every known slug of a product that is no longer public, or a
      // previous slug after a rename.
      const stale = new Set<string>();
      if (product?.status === "published") {
        if (target.previousSlug && target.previousSlug !== product.slug) stale.add(target.previousSlug);
      } else {
        if (product) stale.add(product.slug);
        if (target.previousSlug) stale.add(target.previousSlug);
      }
      if (stale.size > 0) await env.BUCKET.delete([...stale].map((slug) => SNAPSHOT_PATHS.product(slug)));

      if (product?.status === "published") {
        await put(env, SNAPSHOT_PATHS.product(product.slug), toPublicProduct(product, ctx), CACHE_ITEM);
      }
    }
  }
  if (options.rebuildIndexes === false) return;
  await rebuildShards(env, affectedCategories, ctx);
  await rebuildManifest(env);
}

/** Repair tool: rebuilds one category shard (or all) and the manifest from D1. */
export async function resyncShards(env: Env, categoryId?: string): Promise<void> {
  const { ctx, categories } = await buildContext(env);
  await rebuildShards(env, categoryId ? [categoryId] : categories.map((c) => c.id), ctx);
  await rebuildManifest(env);
}

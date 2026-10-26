import { fixPersianLetters, normalizeForSearch, slugify } from "../../../src/domain/persian";
import { buildProductListSql, LIST_COLUMNS, type ProductListQuery } from "../../../src/domain/product/query";
import { validateProductInput, type ImportProductInput, type ProductInput, type ValidationIssue } from "../../../src/domain/product/schema";
import type {
  Fulfillment,
  ProductListRow,
  ProductStatus,
  StoredImage,
  StoredProduct,
  StoredVariant,
} from "../../../src/domain/product/types";
import type { D1DatabaseLike, D1PreparedStatementLike } from "./d1";

export class ConflictError extends Error {
  constructor(public code: "version_conflict" | "slug_taken" | "sku_taken" | "too_many_images" | "category_slug_taken") {
    super(code);
  }
}
export class NotFoundError extends Error {
  constructor() {
    super("not_found");
  }
}
export class ValidationError extends Error {
  constructor(public issues: ValidationIssue[]) {
    super("validation_failed");
  }
}

export interface Deps {
  now: () => string;
  uuid: () => string;
}
export const defaultDeps: Deps = { now: () => new Date().toISOString(), uuid: () => crypto.randomUUID() };

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v);
const nullableNum = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function mapConstraintError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UNIQUE constraint failed: products.slug")) throw new ConflictError("slug_taken");
  if (message.includes("UNIQUE constraint failed: product_variants.sku") || message.includes("idx_variants_sku")) {
    throw new ConflictError("sku_taken");
  }
  if (message.includes("UNIQUE constraint failed: categories.slug")) throw new ConflictError("category_slug_taken");
  throw error;
}

async function runBatch(db: D1DatabaseLike, statements: D1PreparedStatementLike[]) {
  try {
    return await db.batch(statements);
  } catch (error) {
    return mapConstraintError(error);
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

const PRODUCT_COLUMNS = `id, slug, name, description, category_id AS categoryId, status, fulfillment,
  price_toman AS priceToman, inventory, lead_time_days AS leadTimeDays, version,
  created_at AS createdAt, updated_at AS updatedAt, published_at AS publishedAt`;

function toProduct(row: Row, images: StoredImage[], variants: StoredVariant[]): StoredProduct {
  return {
    id: str(row.id),
    slug: str(row.slug),
    name: str(row.name),
    description: str(row.description),
    categoryId: row.categoryId === null ? null : str(row.categoryId),
    status: str(row.status) as ProductStatus,
    fulfillment: str(row.fulfillment) as Fulfillment,
    priceToman: nullableNum(row.priceToman),
    inventory: nullableNum(row.inventory),
    leadTimeDays: nullableNum(row.leadTimeDays),
    images,
    variants,
    version: Number(row.version),
    createdAt: str(row.createdAt),
    updatedAt: str(row.updatedAt),
    publishedAt: row.publishedAt === null ? null : str(row.publishedAt),
  };
}

const toImage = (r: Row): StoredImage => ({ id: str(r.id), key: str(r.key), alt: str(r.alt), position: Number(r.position) });
const toVariant = (r: Row): StoredVariant => ({
  id: str(r.id),
  sku: str(r.sku),
  options: JSON.parse(str(r.options)) as Record<string, string>,
  priceToman: nullableNum(r.priceToman),
  inventory: nullableNum(r.inventory),
  position: Number(r.position),
});

export function toListRow(r: Row): ProductListRow {
  return {
    id: str(r.id),
    slug: str(r.slug),
    name: str(r.name),
    status: str(r.status) as ProductStatus,
    fulfillment: str(r.fulfillment) as Fulfillment,
    categoryId: r.categoryId === null ? null : str(r.categoryId),
    priceToman: nullableNum(r.priceToman),
    inventory: nullableNum(r.inventory),
    leadTimeDays: nullableNum(r.leadTimeDays),
    coverKey: r.coverKey === null ? null : str(r.coverKey),
    coverAlt: r.coverAlt === null ? null : str(r.coverAlt),
    variantCount: Number(r.variantCount),
    variantMinPriceToman: nullableNum(r.variantMinPriceToman),
    variantAvailableCount: Number(r.variantAvailableCount),
    version: Number(r.version),
    updatedAt: str(r.updatedAt),
    publishedAt: r.publishedAt === null ? null : str(r.publishedAt),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listProducts(
  db: D1DatabaseLike,
  query: ProductListQuery,
  forceStatus?: readonly string[],
): Promise<{ items: ProductListRow[]; total: number; page: number; pageSize: number }> {
  const { list, count } = buildProductListSql(query, forceStatus);
  const [rows, total] = await db.batch([db.prepare(list.sql).bind(...list.params), db.prepare(count.sql).bind(...count.params)]);
  return {
    items: ((rows?.results ?? []) as Row[]).map(toListRow),
    total: Number((total?.results?.[0] as Row | undefined)?.total ?? 0),
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** Loads full products (with images and variants) for the given ids in 3 statements. */
export async function getProductsByIds(db: D1DatabaseLike, ids: string[]): Promise<StoredProduct[]> {
  if (ids.length === 0) return [];
  if (ids.length > 90) throw new Error("too_many_ids");
  const marks = ids.map(() => "?").join(",");
  const [products, images, variants] = await db.batch([
    db.prepare(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id IN (${marks})`).bind(...ids),
    db.prepare(`SELECT id, product_id AS productId, r2_key AS key, alt, position FROM product_images WHERE product_id IN (${marks}) ORDER BY position`).bind(...ids),
    db.prepare(`SELECT id, product_id AS productId, sku, options_json AS options, price_toman AS priceToman, inventory, position FROM product_variants WHERE product_id IN (${marks}) ORDER BY position`).bind(...ids),
  ]);
  const imagesBy = new Map<string, StoredImage[]>();
  for (const r of (images?.results ?? []) as Row[]) {
    const list = imagesBy.get(str(r.productId)) ?? [];
    list.push(toImage(r));
    imagesBy.set(str(r.productId), list);
  }
  const variantsBy = new Map<string, StoredVariant[]>();
  for (const r of (variants?.results ?? []) as Row[]) {
    const list = variantsBy.get(str(r.productId)) ?? [];
    list.push(toVariant(r));
    variantsBy.set(str(r.productId), list);
  }
  return ((products?.results ?? []) as Row[]).map((r) => toProduct(r, imagesBy.get(str(r.id)) ?? [], variantsBy.get(str(r.id)) ?? []));
}

export async function getProduct(db: D1DatabaseLike, id: string): Promise<StoredProduct | null> {
  return (await getProductsByIds(db, [id]))[0] ?? null;
}

export async function listCategories(db: D1DatabaseLike) {
  const { results } = await db.prepare("SELECT id, slug, name, parent_id AS parentId, position FROM categories ORDER BY position, name").all<Row>();
  return results.map((r) => ({ id: str(r.id), slug: str(r.slug), name: str(r.name), parentId: r.parentId === null ? null : str(r.parentId), position: Number(r.position) }));
}

export async function listCategoriesWithCounts(db: D1DatabaseLike) {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.slug, c.name, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status = 'published') AS n
       FROM categories c ORDER BY c.position, c.name`,
    )
    .all<Row>();
  return results.map((r) => ({ id: str(r.id), slug: str(r.slug), name: str(r.name), count: Number(r.n) }));
}

/** Published products of a category as flat rows (for snapshot cards). */
export async function listPublishedRows(db: D1DatabaseLike, categoryId: string, limit = 1000): Promise<ProductListRow[]> {
  const { results } = await db
    .prepare(`SELECT ${LIST_COLUMNS} FROM products p WHERE p.status = 'published' AND p.category_id = ? ORDER BY p.published_at DESC, p.id LIMIT ?`)
    .bind(categoryId, limit)
    .all<Row>();
  return results.map(toListRow);
}

export async function getAdmin(db: D1DatabaseLike, email: string) {
  const row = await db.prepare("SELECT email, role, disabled FROM admins WHERE email = ?").bind(email.toLowerCase()).first<Row>();
  if (!row || Number(row.disabled) !== 0) return null;
  return { email: str(row.email), role: str(row.role) as "owner" | "editor" | "viewer" };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function searchText(input: ProductInput): string {
  return normalizeForSearch([input.name, input.description, ...input.variants.map((v) => v.sku)].join(" "));
}

function auditStatement(db: D1DatabaseLike, deps: Deps, actor: string, action: string, entityId: string, detail: object, onlyIfToken?: { productId: string; token: string }) {
  const values = [deps.uuid(), deps.now(), actor, action, "product", entityId, JSON.stringify(detail)];
  if (!onlyIfToken) {
    return db.prepare("INSERT INTO audit_log (id, at, actor_email, action, entity, entity_id, detail_json) VALUES (?,?,?,?,?,?,?)").bind(...values);
  }
  return db
    .prepare(
      `INSERT INTO audit_log (id, at, actor_email, action, entity, entity_id, detail_json)
       SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM products WHERE id = ? AND write_token = ?)`,
    )
    .bind(...values, onlyIfToken.productId, onlyIfToken.token);
}

function childStatements(db: D1DatabaseLike, deps: Deps, productId: string, input: ProductInput, guardToken: string | null) {
  const guard = guardToken ? " WHERE EXISTS (SELECT 1 FROM products WHERE id = ? AND write_token = ?)" : "";
  const guardParams = guardToken ? [productId, guardToken] : [];
  const out: D1PreparedStatementLike[] = [];
  if (guardToken) {
    const del = " WHERE product_id = ? AND EXISTS (SELECT 1 FROM products WHERE id = ? AND write_token = ?)";
    out.push(db.prepare(`DELETE FROM product_images${del}`).bind(productId, productId, guardToken));
    out.push(db.prepare(`DELETE FROM product_variants${del}`).bind(productId, productId, guardToken));
  }
  input.images.forEach((img, position) => {
    out.push(
      db
        .prepare(`INSERT INTO product_images (id, product_id, r2_key, alt, position) SELECT ?,?,?,?,?${guard}`)
        .bind(deps.uuid(), productId, img.key, img.alt, position, ...guardParams),
    );
  });
  input.variants.forEach((v, position) => {
    out.push(
      db
        .prepare(`INSERT INTO product_variants (id, product_id, sku, options_json, price_toman, inventory, position) SELECT ?,?,?,?,?,?,?${guard}`)
        .bind(deps.uuid(), productId, v.sku, JSON.stringify(v.options), v.priceToman, v.inventory, position, ...guardParams),
    );
  });
  return out;
}

function insertStatements(db: D1DatabaseLike, deps: Deps, id: string, input: ProductInput & { slug: string }, actor: string) {
  const now = deps.now();
  return [
    db
      .prepare(
        `INSERT INTO products (id, slug, name, description, category_id, status, fulfillment, price_toman, inventory, lead_time_days,
           search_text, version, write_token, created_at, updated_at, published_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)`,
      )
      .bind(id, input.slug, input.name, input.description, input.categoryId, input.status, input.fulfillment, input.priceToman, input.inventory,
        input.leadTimeDays, searchText(input), deps.uuid(), now, now, input.status === "published" ? now : null),
    ...childStatements(db, deps, id, input, null),
    auditStatement(db, deps, actor, "product.create", id, { slug: input.slug, status: input.status }),
  ];
}

/** `expectedVersion = null` means "overwrite regardless" (CSV import). */
function replaceStatements(db: D1DatabaseLike, deps: Deps, id: string, input: ProductInput, expectedVersion: number | null, actor: string) {
  const now = deps.now();
  const token = deps.uuid();
  return {
    token,
    statements: [
      db
        .prepare(
          `UPDATE products SET slug = COALESCE(?, slug), name = ?, description = ?, category_id = ?, status = ?, fulfillment = ?, price_toman = ?,
             inventory = ?, lead_time_days = ?, search_text = ?, version = version + 1, write_token = ?, updated_at = ?,
             published_at = CASE WHEN ? = 'published' AND published_at IS NULL THEN ? ELSE published_at END
           WHERE id = ? AND (? IS NULL OR version = ?)`,
        )
        .bind(input.slug || null, input.name, input.description, input.categoryId, input.status, input.fulfillment, input.priceToman, input.inventory,
          input.leadTimeDays, searchText(input), token, now, input.status, now, id, expectedVersion, expectedVersion),
      ...childStatements(db, deps, id, input, token),
      auditStatement(db, deps, actor, "product.update", id, { slug: input.slug, status: input.status }, { productId: id, token }),
    ],
  };
}

async function uniqueSlug(db: D1DatabaseLike, base: string, deps: Deps): Promise<string> {
  const root = base || `product-${deps.uuid().slice(0, 8)}`;
  for (let i = 0; i < 10; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    if (!(await db.prepare("SELECT 1 AS x FROM products WHERE slug = ?").bind(candidate).first())) return candidate;
  }
  return `${root}-${deps.uuid().slice(0, 6)}`;
}

export async function createProduct(db: D1DatabaseLike, input: ProductInput, actor: string, deps: Deps = defaultDeps): Promise<StoredProduct> {
  const id = deps.uuid();
  // Explicit slugs must be free (409 if not); generated ones are made unique.
  let slug: string;
  if (input.slug) {
    if (await db.prepare("SELECT 1 AS x FROM products WHERE slug = ?").bind(input.slug).first()) throw new ConflictError("slug_taken");
    slug = input.slug;
  } else {
    slug = await uniqueSlug(db, slugify(input.name), deps);
  }
  await runBatch(db, insertStatements(db, deps, id, { ...input, slug }, actor));
  const created = await getProduct(db, id);
  if (!created) throw new NotFoundError();
  return created;
}

export async function updateProduct(db: D1DatabaseLike, id: string, input: ProductInput, expectedVersion: number, actor: string, deps: Deps = defaultDeps): Promise<StoredProduct> {
  const { statements } = replaceStatements(db, deps, id, input, expectedVersion, actor);
  const results = await runBatch(db, statements);
  if ((results[0]?.meta?.changes ?? 0) === 0) {
    const exists = await db.prepare("SELECT 1 AS x FROM products WHERE id = ?").bind(id).first();
    throw exists ? new ConflictError("version_conflict") : new NotFoundError();
  }
  const updated = await getProduct(db, id);
  if (!updated) throw new NotFoundError();
  return updated;
}

/** Changes status after re-validating the whole product (publishing has extra requirements). */
export async function setProductStatus(db: D1DatabaseLike, id: string, status: ProductStatus, expectedVersion: number, actor: string, deps: Deps = defaultDeps): Promise<StoredProduct> {
  const current = await getProduct(db, id);
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
  return updateProduct(db, id, result.value, expectedVersion, actor, deps);
}

export interface ImportOutcome {
  created: number;
  updated: number;
  affected: Array<{ id: string; previousCategoryId: string | null }>;
}

/** Upserts by slug in a single all-or-nothing batch. Keep chunks small (see IMPORT_CHUNK_MAX). */
export async function importProducts(db: D1DatabaseLike, inputs: ImportProductInput[], actor: string, deps: Deps = defaultDeps): Promise<ImportOutcome> {
  if (inputs.length === 0) return { created: 0, updated: 0, affected: [] };
  if (inputs.length > 90) throw new Error("chunk_too_large");
  const slugs = inputs.map((p) => p.slug);
  const { results } = await db
    .prepare(`SELECT id, slug, category_id AS categoryId FROM products WHERE slug IN (${slugs.map(() => "?").join(",")})`)
    .bind(...slugs)
    .all<Row>();
  const existing = new Map(results.map((r) => [str(r.slug), { id: str(r.id), categoryId: r.categoryId === null ? null : str(r.categoryId) }]));

  const statements: D1PreparedStatementLike[] = [];
  const affected: ImportOutcome["affected"] = [];
  let created = 0;
  let updated = 0;
  for (const input of inputs) {
    const found = existing.get(input.slug);
    if (found) {
      statements.push(...replaceStatements(db, deps, found.id, input, null, actor).statements);
      affected.push({ id: found.id, previousCategoryId: found.categoryId });
      updated++;
    } else {
      const id = deps.uuid();
      statements.push(...insertStatements(db, deps, id, input, actor));
      affected.push({ id, previousCategoryId: null });
      created++;
    }
  }
  await runBatch(db, statements);
  return { created, updated, affected };
}

/** Appends an uploaded image row if the product has room; returns false when the limit is reached. */
export async function addImageRow(db: D1DatabaseLike, productId: string, key: string, alt: string, max: number, actor: string, deps: Deps = defaultDeps): Promise<boolean> {
  const results = await runBatch(db, [
    db
      .prepare(
        `INSERT INTO product_images (id, product_id, r2_key, alt, position)
         SELECT ?, ?, ?, ?, COALESCE((SELECT MAX(position) + 1 FROM product_images WHERE product_id = ?), 0)
         WHERE (SELECT COUNT(*) FROM product_images WHERE product_id = ?) < ?`,
      )
      .bind(deps.uuid(), productId, key, alt, productId, productId, max),
    auditStatement(db, deps, actor, "product.image.add", productId, { key }),
  ]);
  return (results[0]?.meta?.changes ?? 0) > 0;
}

export async function createCategory(db: D1DatabaseLike, input: { slug: string; name: string; parentId?: string | null }, deps: Deps = defaultDeps) {
  const id = deps.uuid();
  await runBatch(db, [
    db
      .prepare("INSERT INTO categories (id, slug, name, parent_id, position, created_at) VALUES (?,?,?,?,(SELECT COALESCE(MAX(position)+1,0) FROM categories),?)")
      .bind(id, input.slug, fixPersianLetters(input.name), input.parentId ?? null, deps.now()),
  ]);
  return { id, slug: input.slug, name: fixPersianLetters(input.name) };
}

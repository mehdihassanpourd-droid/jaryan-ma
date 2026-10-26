import { z } from "zod";
import { escapeLike, normalizeForSearch } from "../persian";
import { FULFILLMENTS, PRODUCT_STATUSES } from "./types";

export const SORTS = {
  updated_desc: "p.updated_at DESC, p.id DESC",
  updated_asc: "p.updated_at ASC, p.id ASC",
  created_desc: "p.created_at DESC, p.id DESC",
  name_asc: "p.name COLLATE NOCASE ASC, p.id ASC",
  price_asc: "p.price_toman ASC, p.id ASC",
  price_desc: "p.price_toman DESC, p.id DESC",
} as const;
export type Sort = keyof typeof SORTS;

export const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_TERMS = 5;

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const productListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  /** Comma separated, e.g. `draft,published`. Omitted = everything except archived. */
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(PRODUCT_STATUSES)).max(3).optional()),
  categoryId: z.string().min(1).max(64).optional(),
  fulfillment: z.enum(FULFILLMENTS).optional(),
  availability: z.enum(["in_stock", "out_of_stock"]).optional(),
  minPrice: int(0, 10_000_000_000).optional(),
  maxPrice: int(0, 10_000_000_000).optional(),
  sort: z.enum(Object.keys(SORTS) as [Sort, ...Sort[]]).default("updated_desc"),
  page: int(1, 10_000).default(1),
  pageSize: int(1, MAX_PAGE_SIZE).default(20),
});
export type ProductListQuery = z.output<typeof productListQuerySchema>;

export function parseProductListQuery(
  params: URLSearchParams,
): { ok: true; value: ProductListQuery } | { ok: false; issues: Array<{ path: string; code: string }> } {
  const raw: Record<string, string> = {};
  for (const [key, value] of params) if (value !== "") raw[key] = value;
  const parsed = productListQuerySchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })) };
}

export interface BuiltQuery {
  sql: string;
  params: Array<string | number>;
}

// COALESCE matters: stock lives on variants for variant products, so p.inventory is NULL and
// `NULL > 0` would make NOT(...) evaluate to NULL and silently drop the row.
const IN_STOCK = `(p.fulfillment = 'made_to_order' OR COALESCE(p.inventory, 0) > 0 OR EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND COALESCE(v.inventory, 0) > 0))`;

/** Columns shared by every product list query (cover + variant summary come from sub-selects). */
export const LIST_COLUMNS = `p.id, p.slug, p.name, p.status, p.fulfillment, p.category_id AS categoryId,
  p.price_toman AS priceToman, p.inventory, p.lead_time_days AS leadTimeDays, p.version,
  p.updated_at AS updatedAt, p.published_at AS publishedAt,
  (SELECT i.r2_key FROM product_images i WHERE i.product_id = p.id ORDER BY i.position LIMIT 1) AS coverKey,
  (SELECT i.alt FROM product_images i WHERE i.product_id = p.id ORDER BY i.position LIMIT 1) AS coverAlt,
  (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id) AS variantCount,
  (SELECT MIN(COALESCE(v.price_toman, p.price_toman)) FROM product_variants v WHERE v.product_id = p.id) AS variantMinPriceToman,
  (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id AND (p.fulfillment = 'made_to_order' OR v.inventory > 0)) AS variantAvailableCount`;

function whereClause(q: ProductListQuery, forceStatus?: readonly string[]): BuiltQuery {
  const where: string[] = [];
  const params: Array<string | number> = [];

  const statuses = forceStatus ?? q.status ?? ["draft", "published"];
  where.push(`p.status IN (${statuses.map(() => "?").join(",")})`);
  params.push(...statuses);

  if (q.categoryId) {
    where.push("p.category_id = ?");
    params.push(q.categoryId);
  }
  if (q.fulfillment) {
    where.push("p.fulfillment = ?");
    params.push(q.fulfillment);
  }
  if (q.availability === "in_stock") where.push(IN_STOCK);
  if (q.availability === "out_of_stock") where.push(`NOT ${IN_STOCK}`);
  if (q.minPrice !== undefined) {
    where.push("p.price_toman >= ?");
    params.push(q.minPrice);
  }
  if (q.maxPrice !== undefined) {
    where.push("p.price_toman <= ?");
    params.push(q.maxPrice);
  }
  if (q.q) {
    const terms = normalizeForSearch(q.q).split(" ").filter(Boolean).slice(0, MAX_SEARCH_TERMS);
    for (const term of terms) {
      where.push("p.search_text LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(term)}%`);
    }
  }
  return { sql: where.join(" AND "), params };
}

/** Columns the inner (paging) query must expose; keep in sync with SORTS and LIST_COLUMNS. */
const PAGE_COLUMNS = `p.id, p.slug, p.name, p.status, p.fulfillment, p.category_id, p.price_toman, p.inventory,
  p.lead_time_days, p.version, p.created_at, p.updated_at, p.published_at`;

/**
 * Parameterised list + count SQL. Only whitelisted fragments are interpolated
 * (sort order, status placeholders); every user value is bound.
 * Pass `forceStatus` to override any client-supplied status filter.
 *
 * Two-step shape on purpose: the inner query filters, sorts and pages on the products
 * table alone, and only the <= pageSize survivors get the cover/variant sub-selects.
 * Otherwise D1 could evaluate those sub-selects for every matching row, multiplying
 * "rows read" (a metered quota) for large catalogues.
 */
export function buildProductListSql(
  q: ProductListQuery,
  forceStatus?: readonly string[],
): { list: BuiltQuery; count: BuiltQuery } {
  const w = whereClause(q, forceStatus);
  const offset = (q.page - 1) * q.pageSize;
  const order = SORTS[q.sort];
  return {
    list: {
      sql: `SELECT ${LIST_COLUMNS} FROM (SELECT ${PAGE_COLUMNS} FROM products p WHERE ${w.sql} ORDER BY ${order} LIMIT ? OFFSET ?) p ORDER BY ${order}`,
      params: [...w.params, q.pageSize, offset],
    },
    count: { sql: `SELECT COUNT(*) AS total FROM products p WHERE ${w.sql}`, params: w.params },
  };
}

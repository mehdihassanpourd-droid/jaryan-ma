import { z } from "zod";
import { MAX_TOMAN } from "../money";
import { normalizeForSearch } from "../persian";
import { FULFILLMENTS, PRODUCT_STATUSES } from "./types";

export const SORT_KEYS = ["updated_desc", "updated_asc", "created_desc", "name_asc", "price_asc", "price_desc"] as const;
export type Sort = (typeof SORT_KEYS)[number];

export const MAX_PAGE_SIZE = 100;
export const MAX_SEARCH_TERMS = 5;

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
  minPrice: int(0, MAX_TOMAN).optional(),
  maxPrice: int(0, MAX_TOMAN).optional(),
  sort: z.enum(SORT_KEYS).default("updated_desc"),
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

/**
 * Search text -> normalised terms (AND-ed by the store). At most MAX_SEARCH_TERMS.
 * `%`, `_` and `\` are removed: ORMs pass `contains` values to SQL LIKE without escaping them, so
 * a lone `_` or `%` would match every product. They carry no meaning in a catalogue search.
 */
export function searchTerms(q: string | undefined): string[] {
  if (!q) return [];
  return normalizeForSearch(q)
    .replace(/[%_\\]/g, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TERMS);
}

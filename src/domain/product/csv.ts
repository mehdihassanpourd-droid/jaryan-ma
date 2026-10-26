import { parseToman } from "../persian";
import { productInputSchema, toValidationIssues, type ImportProductInput } from "./schema";
import type { StoredProduct } from "./types";

/**
 * CSV import/export for products. Designed to run in the admin's browser (CPU-heavy
 * parsing stays off the server) and again, per small chunk, on the server.
 *
 * One product = one or more rows. Rows sharing a `slug` belong to one product; the
 * first row carries the product fields and every row with a `variant_sku` adds a variant.
 * Row numbers in issues count records; the header is row 1.
 */
export const PRODUCT_CSV_COLUMNS = [
  "slug",
  "name",
  "description",
  "category_slug",
  "status",
  "fulfillment",
  "price_toman",
  "inventory",
  "lead_time_days",
  "image_keys",
  "image_alts",
  "variant_sku",
  "variant_options",
  "variant_price_toman",
  "variant_inventory",
] as const;
type Column = (typeof PRODUCT_CSV_COLUMNS)[number];

export const MAX_CSV_CHARS = 2_000_000;
export const MAX_CSV_ROWS = 20_000;

export interface CsvIssue {
  row: number;
  field: string;
  code: string;
}

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

/** RFC 4180 parser: quotes, escaped quotes, embedded newlines, BOM, CRLF. Blank lines are dropped. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
    i++;
  }
  if (inQuotes) throw new CsvParseError("unterminated_quote");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Serialises rows with CRLF line ends and a UTF-8 BOM so Excel/Android apps read Persian correctly. */
export function toCsv(rows: string[][], options: { bom?: boolean } = {}): string {
  const body = rows
    .map((r) =>
      r
        .map((cell) => (/[",\r\n]|^\s|\s$/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
        .join(","),
    )
    .join("\r\n");
  return (options.bom === false ? "" : "﻿") + body + "\r\n";
}

const FORMULA_START = /^[=+\-@\t\r]/;

/** Prefixes `'` to text cells a spreadsheet could execute as a formula (CSV injection). */
export function protectCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

/** Reverses `protectCell` on import. */
export function unprotectCell(value: string): string {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value;
}

type Raw = Record<Column, string>;

function intCell(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = parseToman(trimmed);
  return n === null ? "invalid" : n;
}

function parseOptions(value: string): Record<string, string> | null {
  const options: Record<string, string> = {};
  for (const part of value.split("|")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0 || eq === trimmed.length - 1) return null;
    options[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return Object.keys(options).length > 0 ? options : null;
}

export interface CsvImportResult {
  products: ImportProductInput[];
  issues: CsvIssue[];
  /** Data rows read (header excluded). */
  rowCount: number;
}

const PRODUCT_LEVEL: Column[] = [
  "name",
  "description",
  "category_slug",
  "status",
  "fulfillment",
  "price_toman",
  "inventory",
  "lead_time_days",
  "image_keys",
  "image_alts",
];

/** Parses and validates a product CSV. Never throws; problems are reported as issues. */
export function parseProductCsv(
  text: string,
  options: { categoryIdBySlug: ReadonlyMap<string, string> },
): CsvImportResult {
  const issues: CsvIssue[] = [];
  const empty = (): CsvImportResult => ({ products: [], issues, rowCount: 0 });

  if (text.length > MAX_CSV_CHARS) {
    issues.push({ row: 0, field: "file", code: "csv_too_large" });
    return empty();
  }
  let records: string[][];
  try {
    records = parseCsv(text);
  } catch {
    issues.push({ row: 0, field: "file", code: "csv_unterminated_quote" });
    return empty();
  }
  const header = records[0]?.map((h) => h.trim().toLowerCase());
  if (!header) {
    issues.push({ row: 1, field: "file", code: "csv_empty" });
    return empty();
  }
  if (records.length - 1 > MAX_CSV_ROWS) {
    issues.push({ row: 0, field: "file", code: "csv_too_many_rows" });
    return empty();
  }

  const known = new Set<string>(PRODUCT_CSV_COLUMNS);
  const seenColumns = new Set<string>();
  for (const h of header) {
    if (!known.has(h)) issues.push({ row: 1, field: h, code: "unknown_column" });
    else if (seenColumns.has(h)) issues.push({ row: 1, field: h, code: "duplicate_column" });
    seenColumns.add(h);
  }
  for (const required of ["slug", "name", "fulfillment"] as const) {
    if (!seenColumns.has(required)) issues.push({ row: 1, field: required, code: "missing_column" });
  }
  if (issues.length > 0) return { products: [], issues, rowCount: records.length - 1 };

  const groups = new Map<string, Array<{ row: number; raw: Raw }>>();
  records.slice(1).forEach((cells, index) => {
    const row = index + 2;
    if (cells.length > header.length) {
      issues.push({ row, field: "row", code: "too_many_cells" });
      return;
    }
    const raw = Object.fromEntries(PRODUCT_CSV_COLUMNS.map((c) => [c, ""])) as Raw;
    header.forEach((h, i) => {
      raw[h as Column] = unprotectCell((cells[i] ?? "").trim());
    });
    const slug = raw.slug;
    if (slug === "") {
      issues.push({ row, field: "slug", code: "slug_required" });
      return;
    }
    const list = groups.get(slug) ?? [];
    list.push({ row, raw });
    groups.set(slug, list);
  });

  const products: ImportProductInput[] = [];
  for (const [slug, rows] of groups) {
    const first = rows[0];
    if (!first) continue;
    const groupIssues: CsvIssue[] = [];
    const at = first.row;
    const f = first.raw;

    for (const later of rows.slice(1)) {
      for (const column of PRODUCT_LEVEL) {
        if (later.raw[column] !== "" && later.raw[column] !== f[column]) {
          groupIssues.push({ row: later.row, field: column, code: "conflicting_product_fields" });
        }
      }
    }

    const numbers: Record<string, number | null> = {};
    for (const [column, key] of [
      ["price_toman", "priceToman"],
      ["inventory", "inventory"],
      ["lead_time_days", "leadTimeDays"],
    ] as const) {
      const n = intCell(f[column]);
      if (n === "invalid") groupIssues.push({ row: at, field: column, code: "invalid_number" });
      numbers[key] = n === "invalid" ? null : n;
    }

    let categoryId: string | null = null;
    if (f.category_slug !== "") {
      categoryId = options.categoryIdBySlug.get(f.category_slug) ?? null;
      if (categoryId === null) groupIssues.push({ row: at, field: "category_slug", code: "unknown_category" });
    }

    const keys = f.image_keys.split("|").map((s) => s.trim()).filter(Boolean);
    const alts = f.image_alts.split("|").map((s) => s.trim());
    const images = keys.map((key, i) => ({ key, alt: alts[i] ?? "" }));

    const variants: unknown[] = [];
    for (const { row, raw } of rows) {
      if (raw.variant_sku === "") continue;
      const opts = parseOptions(raw.variant_options);
      if (!opts) {
        groupIssues.push({ row, field: "variant_options", code: "invalid_variant_options" });
        continue;
      }
      const price = intCell(raw.variant_price_toman);
      const inventory = intCell(raw.variant_inventory);
      if (price === "invalid") groupIssues.push({ row, field: "variant_price_toman", code: "invalid_number" });
      if (inventory === "invalid") groupIssues.push({ row, field: "variant_inventory", code: "invalid_number" });
      variants.push({
        sku: raw.variant_sku,
        options: opts,
        priceToman: price === "invalid" ? null : price,
        inventory: inventory === "invalid" ? null : inventory,
      });
    }

    if (groupIssues.length > 0) {
      issues.push(...groupIssues);
      continue;
    }

    const parsed = productInputSchema.safeParse({
      slug,
      name: f.name,
      description: f.description,
      categoryId,
      status: f.status === "" ? "draft" : f.status,
      fulfillment: f.fulfillment,
      ...numbers,
      images,
      variants,
    });
    if (parsed.success) products.push({ ...parsed.data, slug });
    else for (const i of toValidationIssues(parsed.error)) issues.push({ row: at, field: i.path, code: i.code });
  }

  return { products, issues, rowCount: records.length - 1 };
}

/** Builds CSV rows (header first) for export; text cells are protected against formula injection. */
export function productsToCsvRows(
  products: StoredProduct[],
  categorySlugById: ReadonlyMap<string, string>,
): string[][] {
  const rows: string[][] = [[...PRODUCT_CSV_COLUMNS]];
  const num = (n: number | null) => (n === null ? "" : String(n));
  for (const p of products) {
    const sortedImages = [...p.images].sort((a, b) => a.position - b.position);
    const productCells: Record<string, string> = {
      slug: p.slug,
      name: protectCell(p.name),
      description: protectCell(p.description),
      category_slug: (p.categoryId && categorySlugById.get(p.categoryId)) || "",
      status: p.status,
      fulfillment: p.fulfillment,
      price_toman: num(p.priceToman),
      inventory: num(p.inventory),
      lead_time_days: num(p.leadTimeDays),
      image_keys: sortedImages.map((i) => i.key).join("|"),
      image_alts: sortedImages.map((i) => protectCell(i.alt)).join("|"),
    };
    const variants = [...p.variants].sort((a, b) => a.position - b.position);
    const lines = variants.length > 0 ? variants : [null];
    lines.forEach((v, index) => {
      const cells: Record<string, string> =
        index === 0 ? { ...productCells } : { slug: p.slug };
      if (v) {
        cells.variant_sku = v.sku;
        cells.variant_options = protectCell(
          Object.entries(v.options)
            .map(([k, val]) => `${k}=${val}`)
            .join("|"),
        );
        cells.variant_price_toman = num(v.priceToman);
        cells.variant_inventory = num(v.inventory);
      }
      rows.push(PRODUCT_CSV_COLUMNS.map((c) => cells[c] ?? ""));
    });
  }
  return rows;
}

import { z } from "zod";
import { fixPersianLetters } from "../persian";
import { FULFILLMENTS, PRODUCT_STATUSES } from "./types";

/** Machine-readable validation codes. Persian text lives in `messages.fa.ts`. */
export const PRODUCT_ISSUE_CODES = [
  "variants_not_allowed_for_unique",
  "unique_inventory_must_be_0_or_1",
  "lead_time_only_for_made_to_order",
  "inventory_required",
  "inventory_on_variants",
  "variant_inventory_required",
  "lead_time_required",
  "inventory_not_allowed_for_made_to_order",
  "variant_inventory_not_allowed",
  "duplicate_sku",
  "variant_options_mismatch",
  "category_required_to_publish",
  "image_required_to_publish",
  "price_required_to_publish",
  "pipe_not_allowed",
  "equals_not_allowed",
] as const;
export type ProductIssueCode = (typeof PRODUCT_ISSUE_CODES)[number];

export const MAX_IMAGES_PER_PRODUCT = 12;
export const MAX_VARIANTS_PER_PRODUCT = 50;
/** PostgreSQL INTEGER is 32-bit: about 2.1 billion Toman is the ceiling. */
export const MAX_TOMAN = 2_000_000_000;

const toman = z.number().int().min(0).max(MAX_TOMAN);
const stock = z.number().int().min(0).max(100_000);
const noPipe = (s: string) => !s.includes("|");

const text = (max: number, min = 0) => z.string().trim().min(min).max(max).transform(fixPersianLetters);

export const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u, "invalid_slug");

export const imageKeySchema = z
  .string()
  .max(200)
  .regex(/^images\/[A-Za-z0-9-]{1,64}\/[A-Za-z0-9-]{1,64}\.(jpg|png|webp)$/, "invalid_image_key");

export const imageInputSchema = z.object({
  key: imageKeySchema,
  alt: text(200).refine(noPipe, "pipe_not_allowed").default(""),
});

export const variantInputSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, "invalid_sku"),
  options: z
    .record(
      text(40, 1)
        .refine(noPipe, "pipe_not_allowed")
        .refine((s) => !s.includes("="), "equals_not_allowed"),
      text(60, 1).refine(noPipe, "pipe_not_allowed"),
    )
    .refine((o) => Object.keys(o).length >= 1 && Object.keys(o).length <= 3, "variant_needs_1_to_3_options"),
  priceToman: toman.nullable().default(null),
  inventory: stock.nullable().default(null),
});

const baseProductSchema = z.object({
  slug: slugSchema.optional(),
  name: text(120, 2),
  description: text(5000).default(""),
  categoryId: z.string().min(1).max(64).nullable().default(null),
  status: z.enum(PRODUCT_STATUSES).default("draft"),
  fulfillment: z.enum(FULFILLMENTS),
  priceToman: toman.nullable().default(null),
  inventory: stock.nullable().default(null),
  leadTimeDays: z.number().int().min(1).max(365).nullable().default(null),
  images: z.array(imageInputSchema).max(MAX_IMAGES_PER_PRODUCT).default([]),
  variants: z.array(variantInputSchema).max(MAX_VARIANTS_PER_PRODUCT).default([]),
});

type BaseProduct = z.output<typeof baseProductSchema>;
/** `slug` is optional: when absent the server derives a unique one from the name. */
export type ProductInput = BaseProduct;
/** Import always addresses products by slug. */
export type ImportProductInput = BaseProduct & { slug: string };

function consistencyIssues(p: BaseProduct): Array<{ code: ProductIssueCode; path: Array<string | number> }> {
  const issues: Array<{ code: ProductIssueCode; path: Array<string | number> }> = [];
  const add = (code: ProductIssueCode, path: Array<string | number>) => issues.push({ code, path });
  const hasVariants = p.variants.length > 0;

  if (p.fulfillment === "unique") {
    if (hasVariants) add("variants_not_allowed_for_unique", ["variants"]);
    if (p.inventory !== 0 && p.inventory !== 1) add("unique_inventory_must_be_0_or_1", ["inventory"]);
    if (p.leadTimeDays !== null) add("lead_time_only_for_made_to_order", ["leadTimeDays"]);
  } else if (p.fulfillment === "stocked") {
    if (p.leadTimeDays !== null) add("lead_time_only_for_made_to_order", ["leadTimeDays"]);
    if (hasVariants) {
      if (p.inventory !== null) add("inventory_on_variants", ["inventory"]);
      p.variants.forEach((v, i) => {
        if (v.inventory === null) add("variant_inventory_required", ["variants", i, "inventory"]);
      });
    } else if (p.inventory === null) {
      add("inventory_required", ["inventory"]);
    }
  } else {
    if (p.leadTimeDays === null) add("lead_time_required", ["leadTimeDays"]);
    if (p.inventory !== null) add("inventory_not_allowed_for_made_to_order", ["inventory"]);
    p.variants.forEach((v, i) => {
      if (v.inventory !== null) add("variant_inventory_not_allowed", ["variants", i, "inventory"]);
    });
  }

  const seen = new Set<string>();
  p.variants.forEach((v, i) => {
    if (seen.has(v.sku)) add("duplicate_sku", ["variants", i, "sku"]);
    seen.add(v.sku);
  });
  const first = p.variants[0];
  if (first) {
    const keys = Object.keys(first.options).sort().join("|");
    p.variants.forEach((v, i) => {
      if (Object.keys(v.options).sort().join("|") !== keys) add("variant_options_mismatch", ["variants", i, "options"]);
    });
  }

  if (p.status === "published") {
    if (p.categoryId === null) add("category_required_to_publish", ["categoryId"]);
    if (p.images.length === 0) add("image_required_to_publish", ["images"]);
    const priced = hasVariants
      ? p.variants.every((v) => (v.priceToman ?? p.priceToman ?? 0) > 0)
      : (p.priceToman ?? 0) > 0;
    if (!priced) add("price_required_to_publish", ["priceToman"]);
  }
  return issues;
}

/**
 * Full product input validation. Rules by fulfilment type:
 * - unique: no variants, inventory 0 or 1 (defaults to 1)
 * - stocked: inventory on the product, or on every variant when it has variants
 * - made_to_order: needs a lead time, never has inventory
 * Publishing additionally needs a category, at least one image and a price.
 */
export const productInputSchema = baseProductSchema
  .transform((p) => (p.fulfillment === "unique" && p.inventory === null ? { ...p, inventory: 1 } : p))
  .superRefine((p, ctx) => {
    for (const issue of consistencyIssues(p)) {
      ctx.addIssue({ code: "custom", message: issue.code, path: issue.path });
    }
  });

export interface ValidationIssue {
  path: string;
  code: string;
}

/** Flattens a zod error to `{ path, code }`; custom issues carry their own code. */
export function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code === "custom" ? issue.message : `invalid_${issue.code}`,
  }));
}

export function validateProductInput(
  raw: unknown,
): { ok: true; value: ProductInput } | { ok: false; issues: ValidationIssue[] } {
  const parsed = productInputSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, issues: toValidationIssues(parsed.error) };
}

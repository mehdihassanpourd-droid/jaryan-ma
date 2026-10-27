import { z } from "zod";
import { slugSchema } from "../product/schema";
import { pickupContactSchema, shippingInputSchema } from "./schema";
import { MAX_TOMAN } from "../money";
import { fixPersianLetters } from "../persian";
import { isIranProvince } from "./geo";

/**
 * What the storefront sends to place an order: WHICH products and how many, never prices or totals. The server reads
 * every price, availability and title from the database, so nothing the browser claims about money is ever trusted.
 */
export const MAX_ORDER_LINES = 50;
/** Handmade goods: a single line above this is almost certainly a mistake (and not something the studio can promise). */
export const MAX_LINE_QUANTITY = 20;
/** Pending/confirmed/preparing/shipped orders a customer may have at once (protects the owner from order floods). */
export const MAX_OPEN_ORDERS = 10;

export const checkoutLineSchema = z
  .object({
    slug: slugSchema,
    /** The variant's SKU; null for a product without variants. */
    sku: z.string().trim().min(1).max(64).nullable().default(null),
    quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  })
  .strict();
export type CheckoutLine = z.output<typeof checkoutLineSchema>;

const checkoutCommon = {
  items: z.array(checkoutLineSchema).min(1).max(MAX_ORDER_LINES),
  customerNote: z
    .string()
    .trim()
    .max(300)
    .transform(fixPersianLetters)
    .transform((v) => (v === "" ? null : v))
    .nullish()
    .transform((v) => v ?? null),
  /** Chosen by the browser once per checkout attempt: a retry of the same attempt can never create a second order. */
  requestId: z.string().uuid(),
  /** The delivery fee the customer was SHOWN. The server prices the delivery itself and refuses the order if its price differs. */
  expectedFeeToman: z.number().int().min(0).max(MAX_TOMAN),
};

export const checkoutRequestSchema = z
  .discriminatedUnion("deliveryMethod", [
    /** Collecting in person: only who comes for it. */
    z.object({ ...checkoutCommon, deliveryMethod: z.literal("pickup"), shipping: pickupContactSchema }).strict(),
    /** Anything that is carried to an address: the full, validated address. */
    z.object({ ...checkoutCommon, deliveryMethod: z.enum(["post", "tipax", "local_courier"]), shipping: shippingInputSchema }).strict(),
  ])
  .superRefine((request, ctx) => {
    const seen = new Set<string>();
    request.items.forEach((line, i) => {
      const key = `${line.slug}|${line.sku ?? ""}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", message: "duplicate_line", path: ["items", i] });
      seen.add(key);
    });
  });
export type CheckoutRequest = z.output<typeof checkoutRequestSchema>;

/** Why one line cannot be ordered right now (shown next to that line). */
export type LineProblemReason =
  | "not_found" // not (or no longer) published
  | "variant_required"
  | "variant_not_found"
  | "sold_out"
  | "insufficient_stock"
  | "quantity_not_allowed" // e.g. more than one of a unique piece
  | "no_price";

export interface LineProblem {
  slug: string;
  sku: string | null;
  reason: LineProblemReason;
  /** For `insufficient_stock`: how many can still be ordered. */
  available?: number;
}

/** Asks what delivery would cost for a cart (before ordering). No address yet = only pickup can be priced. */
export const quoteRequestSchema = z
  .object({
    items: z.array(checkoutLineSchema).min(1).max(MAX_ORDER_LINES),
    destination: z
      .object({
        province: z.string().trim().refine(isIranProvince, "invalid_province"),
        city: z.string().trim().min(2).max(60).transform(fixPersianLetters),
      })
      .strict()
      .nullish()
      .transform((v) => v ?? null),
  })
  .strict()
  .superRefine((request, ctx) => {
    const seen = new Set<string>();
    request.items.forEach((line, i) => {
      const key = `${line.slug}|${line.sku ?? ""}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", message: "duplicate_line", path: ["items", i] });
      seen.add(key);
    });
  });
export type QuoteRequest = z.output<typeof quoteRequestSchema>;

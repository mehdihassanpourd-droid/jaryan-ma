import { z } from "zod";
import { MAX_TOMAN, lineTotal, sumToman } from "../money";
import { fixPersianLetters, toLatinDigits } from "../persian";
import { E164_IRAN_MOBILE, normalizeIranMobile } from "../phone";
import { IRAN_PROVINCES, isIranProvince, normalizePostalCode } from "./geo";

export const MAX_ADDRESSES_PER_CUSTOMER = 10;
export const MAX_FAVORITES_PER_CUSTOMER = 500;
/** Bump when the terms change; customers accept a version. */
export const CURRENT_TERMS_VERSION = "2026-01";

const text = (min: number, max: number) => z.string().trim().min(min).max(max).transform(fixPersianLetters);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform(fixPersianLetters)
    .transform((v) => (v === "" ? null : v))
    .nullish()
    .transform((v) => v ?? null);

/** Any common form -> canonical +989XXXXXXXXX, or a validation error. */
export const phoneSchema = z
  .string()
  .max(40)
  .transform((v, ctx) => {
    const phone = normalizeIranMobile(v);
    if (!phone) ctx.addIssue({ code: "custom", message: "invalid_phone" });
    return phone ?? "";
  });

/** Six digits; Persian and Arabic digits are accepted. */
export const otpCodeSchema = z
  .string()
  .max(12)
  .transform((v) => toLatinDigits(v).replace(/\s/g, ""))
  .refine((v) => /^\d{6}$/.test(v), "invalid_code");

export const otpRequestSchema = z.object({ phone: phoneSchema }).strict();
export const otpVerifySchema = z.object({ phone: phoneSchema, code: otpCodeSchema, acceptTerms: z.boolean().optional() }).strict();

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "invalid_email");

/** Profile changes. `.strict()` rejects unknown keys, so a client can never set status, phone, etc. */
export const profileUpdateSchema = z
  .object({
    firstName: optionalText(50).optional(),
    lastName: optionalText(50).optional(),
    email: emailSchema.or(z.literal("").transform(() => null)).nullable().optional(),
    marketingOptIn: z.boolean().optional(),
  })
  .strict();
export type ProfileUpdate = z.output<typeof profileUpdateSchema>;

const postalCodeSchema = z
  .string()
  .max(20)
  .transform((v, ctx) => {
    const code = normalizePostalCode(v);
    if (!code) ctx.addIssue({ code: "custom", message: "invalid_postal_code" });
    return code ?? "";
  });

/** The delivery fields an address and a checkout share, so the two can never validate differently. */
const deliveryFields = {
  recipientName: text(2, 80),
  recipientPhone: phoneSchema,
  province: z.string().trim().refine(isIranProvince, "invalid_province"),
  city: text(2, 60),
  street: text(5, 200),
  plaque: optionalText(10),
  unit: optionalText(10),
  postalCode: postalCodeSchema,
};

export const addressInputSchema = z
  .object({
    label: optionalText(30),
    ...deliveryFields,
    notes: optionalText(200),
    isDefault: z.boolean().default(false),
  })
  .strict();
export type AddressInput = z.output<typeof addressInputSchema>;

/** Delivery details typed at checkout (same rules as an address book entry). */
export const shippingInputSchema = z.object(deliveryFields).strict();
export type ShippingInput = z.output<typeof shippingInputSchema>;

/** Delivery details frozen into an order. */
export interface ShippingSnapshot {
  recipientName: string | null;
  recipientPhone: string | null;
  province: string;
  city: string;
  street: string | null;
  plaque: string | null;
  unit: string | null;
  postalCode: string | null;
}

export const REDACTED = "[حذف شده]";

/** Personal parts removed on anonymisation; province and city stay (useful, non-identifying statistics). */
export function scrubShipping(shipping: unknown): ShippingSnapshot {
  const s = (typeof shipping === "object" && shipping !== null ? shipping : {}) as Partial<ShippingSnapshot>;
  return { recipientName: REDACTED, recipientPhone: null, province: s.province ?? "", city: s.city ?? "", street: REDACTED, plaque: null, unit: null, postalCode: null };
}

// --- orders -----------------------------------------------------------------------------------------------

export const orderItemInputSchema = z.object({
  productId: z.string().min(1).max(64),
  vendorId: z.string().min(1).max(64),
  titleSnapshot: text(1, 200),
  skuSnapshot: z.string().max(64).nullable().default(null),
  variantSnapshot: z.record(z.string(), z.string()).nullable().default(null),
  imageKeySnapshot: z.string().max(200).nullable().default(null),
  unitPriceToman: z.number().int().min(0).max(MAX_TOMAN),
  quantity: z.number().int().min(1).max(1000),
  /** True: this line's quantity is taken out of the product's/variant's inventory with the order (and given back if it ends rejected or cancelled). */
  reserveStock: z.boolean().default(false),
});

export const newOrderSchema = z
  .object({
    customerId: z.string().min(1).max(64),
    items: z.array(orderItemInputSchema).min(1).max(100),
    shipping: z.object({
      recipientName: text(2, 80),
      recipientPhone: phoneSchema,
      province: z.enum(IRAN_PROVINCES),
      city: text(2, 60),
      street: text(5, 200),
      plaque: z.string().max(10).nullable().default(null),
      unit: z.string().max(10).nullable().default(null),
      postalCode: postalCodeSchema,
    }),
    customerNote: optionalText(300),
    /** Idempotency key of the checkout attempt (see `Order.requestId`). */
    requestId: z.string().uuid().nullable().default(null),
    /** What the caller believes the total is; must equal the exact sum of the lines. */
    totalToman: z.number().int().min(0).max(MAX_TOMAN),
  })
  .strict()
  .superRefine((order, ctx) => {
    try {
      const sum = sumToman(order.items.map((i) => lineTotal(i.unitPriceToman, i.quantity)));
      if (sum !== order.totalToman) ctx.addIssue({ code: "custom", message: "order_total_mismatch", path: ["totalToman"] });
    } catch {
      ctx.addIssue({ code: "custom", message: "order_total_out_of_range", path: ["totalToman"] });
    }
  });
export type NewOrderInput = z.output<typeof newOrderSchema>;

export const formatOrderNumber = (n: number) => `JM-${100000 + n}`;
export const formatTicketNumber = (n: number) => `T-${1000 + n}`;

export { E164_IRAN_MOBILE };

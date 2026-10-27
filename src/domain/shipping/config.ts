import { z } from "zod";
import { MAX_TOMAN } from "../money";
import { fixPersianLetters } from "../persian";
import { IRAN_PROVINCES } from "../customer/geo";
import { SHIPPING_METHODS, methodNeedsAddress } from "./methods";
import { normaliseCity } from "./pricing";

/** What the owner edits on the shipping screen. One save replaces the whole table (all methods, all their rates). */
export const MAX_RATES_PER_METHOD = 200;
export const MAX_CITIES_PER_RATE = 60;
export const MAX_WEIGHT_GRAMS = 1_000_000;
export const MAX_ETA_DAYS = 90;

const toman = z.number().int().min(0).max(MAX_TOMAN);
const grams = (min: number, max: number) => z.number().int().min(min).max(max);

export const rateInputSchema = z
  .object({
    provinces: z.array(z.string().refine((p) => (IRAN_PROVINCES as readonly string[]).includes(p), "invalid_province")).max(IRAN_PROVINCES.length).default([]),
    cities: z.array(z.string().trim().min(2).max(60).transform(fixPersianLetters)).max(MAX_CITIES_PER_RATE).default([]),
    minWeightGrams: grams(0, MAX_WEIGHT_GRAMS).default(0),
    maxWeightGrams: grams(0, MAX_WEIGHT_GRAMS).nullable().default(null),
    priceToman: toman,
  })
  .strict();
export type RateInput = z.output<typeof rateInputSchema>;

export const methodInputSchema = z
  .object({
    method: z.enum(SHIPPING_METHODS),
    enabled: z.boolean(),
    freeThresholdToman: toman.nullable().default(null),
    etaMinDays: z.number().int().min(1).max(MAX_ETA_DAYS).nullable().default(null),
    etaMaxDays: z.number().int().min(1).max(MAX_ETA_DAYS).nullable().default(null),
    note: z
      .string()
      .trim()
      .max(300)
      .transform(fixPersianLetters)
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .default(null),
    rates: z.array(rateInputSchema).max(MAX_RATES_PER_METHOD).default([]),
  })
  .strict();
export type MethodInput = z.output<typeof methodInputSchema>;

export const shippingConfigSchema = z
  .object({
    /** The version the screen was loaded with: a save made from an older screen is refused instead of overwriting newer changes. */
    expectedVersion: z.number().int().min(1),
    defaultItemWeightGrams: grams(1, 100_000),
    packagingWeightGrams: grams(0, 100_000),
    methods: z.array(methodInputSchema).min(1).max(SHIPPING_METHODS.length),
  })
  .strict()
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.methods.forEach((m, mi) => {
      const at = (...path: Array<string | number>) => ["methods", mi, ...path];
      if (seen.has(m.method)) ctx.addIssue({ code: "custom", message: "duplicate_method", path: at("method") });
      seen.add(m.method);
      if (m.etaMinDays !== null && m.etaMaxDays !== null && m.etaMaxDays < m.etaMinDays) ctx.addIssue({ code: "custom", message: "eta_range", path: at("etaMaxDays") });
      if (!methodNeedsAddress(m.method)) {
        if (m.rates.length > 0) ctx.addIssue({ code: "custom", message: "pickup_has_no_rates", path: at("rates") });
        if (m.freeThresholdToman !== null) ctx.addIssue({ code: "custom", message: "pickup_has_no_threshold", path: at("freeThresholdToman") });
        return;
      }
      if (m.enabled && m.rates.length === 0) ctx.addIssue({ code: "custom", message: "enabled_needs_rate", path: at("rates") });
      m.rates.forEach((r, ri) => {
        if (r.maxWeightGrams !== null && r.maxWeightGrams < r.minWeightGrams) ctx.addIssue({ code: "custom", message: "weight_band", path: at("rates", ri, "maxWeightGrams") });
        if (r.cities.length > 0 && r.provinces.length === 0) ctx.addIssue({ code: "custom", message: "cities_need_province", path: at("rates", ri, "cities") });
        if (new Set(r.provinces).size !== r.provinces.length) ctx.addIssue({ code: "custom", message: "duplicate_province", path: at("rates", ri, "provinces") });
      });
      // Two rows for the same place whose weight bands overlap would make the price ambiguous.
      const scope = (r: (typeof m.rates)[number]) => `${[...r.provinces].sort().join("|")}#${r.cities.map(normaliseCity).sort().join("|")}`;
      m.rates.forEach((a, i) =>
        m.rates.forEach((b, j) => {
          if (j <= i || scope(a) !== scope(b)) return;
          const overlap = a.minWeightGrams <= (b.maxWeightGrams ?? Infinity) && b.minWeightGrams <= (a.maxWeightGrams ?? Infinity);
          if (overlap) ctx.addIssue({ code: "custom", message: "overlapping_rates", path: at("rates", j, "minWeightGrams") });
        }),
      );
    });
  });
export type ShippingConfigInput = z.output<typeof shippingConfigSchema>;

/** The stored table as the admin screen receives it. */
export interface ShippingConfigJson {
  version: number;
  defaultItemWeightGrams: number;
  packagingWeightGrams: number;
  methods: Array<MethodInput & { rates: Array<RateInput & { id: string }> }>;
}

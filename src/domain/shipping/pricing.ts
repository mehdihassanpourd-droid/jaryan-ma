import { fixPersianLetters, toLatinDigits } from "../persian";
import { methodNeedsAddress, type ShippingMethodKey } from "./methods";

/**
 * Shipping fees from the owner's rate table. PURE: no database, no clock, no network. The server runs these rules on the
 * order's real lines; the browser only displays what the server quoted.
 */
export interface RateRule {
  id: string;
  /** Empty = any province. */
  provinces: string[];
  /** Empty = every city of the listed provinces. */
  cities: string[];
  minWeightGrams: number;
  /** null = no upper limit. */
  maxWeightGrams: number | null;
  priceToman: number;
}

export interface MethodRules {
  method: ShippingMethodKey;
  enabled: boolean;
  etaMinDays: number | null;
  etaMaxDays: number | null;
  note: string | null;
  rates: RateRule[];
}

export interface WeightSettings {
  defaultItemWeightGrams: number;
  packagingWeightGrams: number;
}

export interface Destination {
  province: string;
  city: string;
}

/** City names are compared after digit/letter normalisation, so «کرج» typed with Arabic ی/ک still matches. */
export const normaliseCity = (value: string): string => fixPersianLetters(toLatinDigits(value)).replace(/\s+/g, " ").trim();

/** Total packed weight: every unit (its own weight, else the shop default) plus the packaging. */
export function cartWeightGrams(lines: Array<{ quantity: number; weightGrams: number | null }>, settings: WeightSettings): number {
  const items = lines.reduce((sum, line) => sum + line.quantity * (line.weightGrams ?? settings.defaultItemWeightGrams), 0);
  return items + settings.packagingWeightGrams;
}

function specificity(rate: RateRule): 0 | 1 | 2 {
  return rate.cities.length > 0 ? 2 : rate.provinces.length > 0 ? 1 : 0;
}

/**
 * The rate row for this destination and weight. A city-specific row beats a province row beats an "anywhere" row; among
 * equally specific rows the narrower band (higher minimum weight) wins, then the one listed first. null = not served.
 */
export function matchRate(rates: RateRule[], destination: Destination, weightGrams: number): RateRule | null {
  const city = normaliseCity(destination.city);
  let best: RateRule | null = null;
  for (const rate of rates) {
    if (weightGrams < rate.minWeightGrams || (rate.maxWeightGrams !== null && weightGrams > rate.maxWeightGrams)) continue;
    if (rate.provinces.length > 0 && !rate.provinces.includes(destination.province)) continue;
    if (rate.cities.length > 0 && !rate.cities.some((c) => normaliseCity(c) === city)) continue;
    if (!best || specificity(rate) > specificity(best) || (specificity(rate) === specificity(best) && rate.minWeightGrams > best.minWeightGrams)) best = rate;
  }
  return best;
}

export type UnavailableReason = "disabled" | "address_required" | "not_served";

export type MethodQuote =
  | {
      method: ShippingMethodKey;
      available: true;
      feeToman: number;
      /** True when the fee is 0 because the order reached the free-shipping threshold. */
      free: boolean;
      etaMinDays: number | null;
      etaMaxDays: number | null;
      note: string | null;
      rateId: string | null;
    }
  | { method: ShippingMethodKey; available: false; reason: UnavailableReason };

/** The shop-wide free shipping policy (admin screen «ارسال رایگان»). */
export interface FreeShippingRule {
  enabled: boolean;
  /** Items subtotal (whole Toman) at or above which the fee is waived. null only while disabled. */
  thresholdToman: number | null;
  /** Methods that qualify (pickup never needs it: it is always free). */
  methods: ShippingMethodKey[];
}

/** What a shopper is told about free shipping for the cart they hold. */
export interface FreeShippingProgress {
  enabled: boolean;
  thresholdToman: number | null;
  methods: ShippingMethodKey[];
  /** Toman still to add to the items subtotal to qualify (0 = qualified). null when the policy is off. */
  remainingToman: number | null;
  qualified: boolean;
}

export function freeShippingProgress(rule: FreeShippingRule, subtotalToman: number): FreeShippingProgress {
  if (!rule.enabled || rule.thresholdToman === null || rule.methods.length === 0) return { enabled: false, thresholdToman: null, methods: [], remainingToman: null, qualified: false };
  const remaining = Math.max(0, rule.thresholdToman - subtotalToman);
  return { enabled: true, thresholdToman: rule.thresholdToman, methods: rule.methods, remainingToman: remaining, qualified: remaining === 0 };
}

/**
 * The policy applied to a quote from ANY provider: an available, qualifying method costs nothing once the items subtotal reaches
 * the threshold. A destination the method does not serve stays unavailable (free shipping never invents coverage).
 */
export function applyFreeShipping(quote: MethodQuote, rule: FreeShippingRule, subtotalToman: number): MethodQuote {
  if (!quote.available || quote.method === "pickup") return quote;
  const progress = freeShippingProgress(rule, subtotalToman);
  if (!progress.qualified || !progress.methods.includes(quote.method)) return quote;
  return { ...quote, feeToman: 0, free: true };
}

/**
 * One method's price for this cart (before the free shipping policy, see `applyFreeShipping`). `destination` null = no address typed yet.
 */
export function quoteMethod(rules: MethodRules, destination: Destination | null, weightGrams: number): MethodQuote {
  const { method } = rules;
  if (!rules.enabled) return { method, available: false, reason: "disabled" };
  const eta = { etaMinDays: rules.etaMinDays, etaMaxDays: rules.etaMaxDays, note: rules.note };
  if (!methodNeedsAddress(method)) return { method, available: true, feeToman: 0, free: false, rateId: null, ...eta };
  if (!destination || !destination.province || !destination.city) return { method, available: false, reason: "address_required" };
  const rate = matchRate(rules.rates, destination, weightGrams);
  if (!rate) return { method, available: false, reason: "not_served" };
  return { method, available: true, feeToman: rate.priceToman, free: false, rateId: rate.id, ...eta };
}

export function quoteAll(all: MethodRules[], destination: Destination | null, weightGrams: number): MethodQuote[] {
  return all.map((rules) => quoteMethod(rules, destination, weightGrams));
}

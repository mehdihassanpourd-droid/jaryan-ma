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
  /** Items subtotal at or above which the delivery is free. null = never free. */
  freeThresholdToman: number | null;
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

/**
 * One method's price for this cart. `destination` null = no address typed yet. Free shipping only waives the fee: the
 * destination must still be inside the area the owner priced.
 */
export function quoteMethod(rules: MethodRules, destination: Destination | null, weightGrams: number, subtotalToman: number): MethodQuote {
  const { method } = rules;
  if (!rules.enabled) return { method, available: false, reason: "disabled" };
  const eta = { etaMinDays: rules.etaMinDays, etaMaxDays: rules.etaMaxDays, note: rules.note };
  if (!methodNeedsAddress(method)) return { method, available: true, feeToman: 0, free: false, rateId: null, ...eta };
  if (!destination || !destination.province || !destination.city) return { method, available: false, reason: "address_required" };
  const rate = matchRate(rules.rates, destination, weightGrams);
  if (!rate) return { method, available: false, reason: "not_served" };
  const free = rules.freeThresholdToman !== null && subtotalToman >= rules.freeThresholdToman;
  return { method, available: true, feeToman: free ? 0 : rate.priceToman, free, rateId: rate.id, ...eta };
}

export function quoteAll(all: MethodRules[], destination: Destination | null, weightGrams: number, subtotalToman: number): MethodQuote[] {
  return all.map((rules) => quoteMethod(rules, destination, weightGrams, subtotalToman));
}

import { describe, expect, it } from "vitest";
import { shippingConfigSchema } from "./config";

const method = (over: Record<string, unknown> = {}) => ({ method: "post", enabled: true, rates: [{ provinces: [], cities: [], priceToman: 1000 }], ...over });
const config = (methods: unknown[], over: Record<string, unknown> = {}) => ({ expectedVersion: 1, defaultItemWeightGrams: 500, packagingWeightGrams: 0, methods, ...over });
const messages = (input: unknown) => {
  const r = shippingConfigSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}:${i.message}`);
};

describe("shipping configuration rules", () => {
  it("accepts a sensible table", () => {
    expect(messages(config([method(), { method: "pickup", enabled: true, note: "گالری" }]))).toEqual([]);
  });

  it("refuses an enabled courier method with no price (it could never deliver)", () => {
    expect(messages(config([method({ rates: [] })]))).toContain("methods.0.rates:enabled_needs_rate");
    expect(messages(config([method({ rates: [], enabled: false })]))).toEqual([]);
  });

  it("refuses pickup rates and pickup free thresholds (pickup is always free)", () => {
    expect(messages(config([{ method: "pickup", enabled: true, rates: [{ priceToman: 1 }] }]))).toContain("methods.0.rates:pickup_has_no_rates");
    expect(messages(config([{ method: "pickup", enabled: true, freeThresholdToman: 100 }]))).toContain("methods.0.freeThresholdToman:pickup_has_no_threshold");
  });

  it("refuses unknown provinces, cities without a province, backwards weight bands and backwards day ranges", () => {
    expect(messages(config([method({ rates: [{ provinces: ["جایی"], priceToman: 1 }] })]))).toEqual(expect.arrayContaining([expect.stringContaining("invalid_province")]));
    expect(messages(config([method({ rates: [{ provinces: [], cities: ["کرج"], priceToman: 1 }] })]))).toContain("methods.0.rates.0.cities:cities_need_province");
    expect(messages(config([method({ rates: [{ provinces: [], cities: [], minWeightGrams: 500, maxWeightGrams: 100, priceToman: 1 }] })]))).toContain("methods.0.rates.0.maxWeightGrams:weight_band");
    expect(messages(config([method({ etaMinDays: 5, etaMaxDays: 2 })]))).toContain("methods.0.etaMaxDays:eta_range");
  });

  it("refuses two prices for the same place and overlapping weights, but allows the same place in separate bands", () => {
    const light = { provinces: ["تهران"], cities: [], minWeightGrams: 0, maxWeightGrams: 1000, priceToman: 1 };
    expect(messages(config([method({ rates: [light, { ...light, minWeightGrams: 1000, maxWeightGrams: null }] })]))).toContain("methods.0.rates.1.minWeightGrams:overlapping_rates");
    expect(messages(config([method({ rates: [light, { ...light, minWeightGrams: 1001, maxWeightGrams: null }] })]))).toEqual([]);
    expect(messages(config([method({ rates: [light, { ...light, provinces: ["فارس"] }] })]))).toEqual([]);
  });

  it("refuses money outside the supported range and extra keys", () => {
    expect(messages(config([method({ freeThresholdToman: -1 })]))).not.toEqual([]);
    expect(messages(config([method({ rates: [{ provinces: [], cities: [], priceToman: 10 ** 16 }] })]))).not.toEqual([]);
    expect(messages(config([method({ surprise: true })]))).not.toEqual([]);
  });
});

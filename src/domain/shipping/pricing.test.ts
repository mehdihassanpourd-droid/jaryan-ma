import { describe, expect, it } from "vitest";
import { cartWeightGrams, matchRate, normaliseCity, quoteMethod, type MethodRules, type RateRule } from "./pricing";

const rate = (id: string, over: Partial<RateRule> = {}): RateRule => ({ id, provinces: [], cities: [], minWeightGrams: 0, maxWeightGrams: null, priceToman: 100_000, ...over });
const post = (rates: RateRule[], over: Partial<MethodRules> = {}): MethodRules => ({ method: "post", enabled: true, freeThresholdToman: null, etaMinDays: 3, etaMaxDays: 7, note: null, rates, ...over });
const tehran = { province: "تهران", city: "تهران" };

describe("cart weight", () => {
  it("adds every unit (own weight, else the shop default) and the packaging", () => {
    expect(cartWeightGrams([{ quantity: 2, weightGrams: 300 }, { quantity: 1, weightGrams: null }], { defaultItemWeightGrams: 500, packagingWeightGrams: 120 })).toBe(2 * 300 + 500 + 120);
  });
});

describe("matching a rate", () => {
  it("serves nowhere with no rows, and respects the weight band edges", () => {
    expect(matchRate([], tehran, 100)).toBeNull();
    const rows = [rate("light", { maxWeightGrams: 1000 }), rate("heavy", { minWeightGrams: 1001, priceToman: 250_000 })];
    expect(matchRate(rows, tehran, 1000)?.id).toBe("light");
    expect(matchRate(rows, tehran, 1001)?.id).toBe("heavy");
    expect(matchRate([rate("only-light", { maxWeightGrams: 1000 })], tehran, 1001)).toBeNull();
  });

  it("prefers a city row over a province row over an anywhere row", () => {
    const rows = [rate("anywhere", { priceToman: 300_000 }), rate("province", { provinces: ["تهران"], priceToman: 200_000 }), rate("city", { provinces: ["تهران"], cities: ["تهران"], priceToman: 90_000 })];
    expect(matchRate(rows, tehran, 10)?.id).toBe("city");
    expect(matchRate(rows, { province: "تهران", city: "ری" }, 10)?.id).toBe("province");
    expect(matchRate(rows, { province: "فارس", city: "شیراز" }, 10)?.id).toBe("anywhere");
  });

  it("compares city names after normalising Arabic letters, digits and spaces", () => {
    expect(normaliseCity("  كرج ")).toBe("کرج");
    const rows = [rate("karaj", { provinces: ["البرز"], cities: ["کرج"] })];
    expect(matchRate(rows, { province: "البرز", city: "كرج" }, 1)?.id).toBe("karaj");
    expect(matchRate(rows, { province: "تهران", city: "کرج" }, 1)).toBeNull(); // right city name, wrong province
  });
});

describe("quoting one method", () => {
  it("is unavailable when disabled, without an address, or outside the priced area", () => {
    expect(quoteMethod(post([rate("a")], { enabled: false }), tehran, 10, 1000)).toEqual({ method: "post", available: false, reason: "disabled" });
    expect(quoteMethod(post([rate("a")]), null, 10, 1000)).toEqual({ method: "post", available: false, reason: "address_required" });
    expect(quoteMethod(post([rate("a", { provinces: ["فارس"] })]), tehran, 10, 1000)).toEqual({ method: "post", available: false, reason: "not_served" });
  });

  it("charges the matched rate and reports the promised days", () => {
    expect(quoteMethod(post([rate("a", { priceToman: 85_000 })]), tehran, 10, 1000)).toMatchObject({ available: true, feeToman: 85_000, free: false, etaMinDays: 3, etaMaxDays: 7, rateId: "a" });
  });

  it("waives the fee at the free-shipping threshold, but only inside the priced area", () => {
    const rules = post([rate("a", { provinces: ["تهران"] })], { freeThresholdToman: 2_000_000 });
    expect(quoteMethod(rules, tehran, 10, 1_999_999)).toMatchObject({ feeToman: 100_000, free: false });
    expect(quoteMethod(rules, tehran, 10, 2_000_000)).toMatchObject({ feeToman: 0, free: true });
    expect(quoteMethod(rules, { province: "فارس", city: "شیراز" }, 10, 9_000_000)).toMatchObject({ available: false, reason: "not_served" });
  });

  it("pickup needs no address and costs nothing, but only when enabled", () => {
    const pickup: MethodRules = { method: "pickup", enabled: true, freeThresholdToman: null, etaMinDays: null, etaMaxDays: null, note: "گالری", rates: [] };
    expect(quoteMethod(pickup, null, 10, 1000)).toMatchObject({ available: true, feeToman: 0, free: false, note: "گالری", rateId: null });
    expect(quoteMethod({ ...pickup, enabled: false }, null, 10, 1000)).toMatchObject({ available: false, reason: "disabled" });
  });
});

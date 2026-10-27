import { describe, expect, it } from "vitest";
import { applyFreeShipping, cartWeightGrams, freeShippingProgress, matchRate, normaliseCity, quoteMethod, type FreeShippingRule, type MethodRules, type RateRule } from "./pricing";

const rate = (id: string, over: Partial<RateRule> = {}): RateRule => ({ id, provinces: [], cities: [], minWeightGrams: 0, maxWeightGrams: null, priceToman: 100_000, ...over });
const post = (rates: RateRule[], over: Partial<MethodRules> = {}): MethodRules => ({ method: "post", enabled: true, etaMinDays: 3, etaMaxDays: 7, note: null, rates, ...over });
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
    expect(quoteMethod(post([rate("a")], { enabled: false }), tehran, 10)).toEqual({ method: "post", available: false, reason: "disabled" });
    expect(quoteMethod(post([rate("a")]), null, 10)).toEqual({ method: "post", available: false, reason: "address_required" });
    expect(quoteMethod(post([rate("a", { provinces: ["فارس"] })]), tehran, 10)).toEqual({ method: "post", available: false, reason: "not_served" });
  });

  it("charges the matched rate and reports the promised days", () => {
    expect(quoteMethod(post([rate("a", { priceToman: 85_000 })]), tehran, 10)).toMatchObject({ available: true, feeToman: 85_000, free: false, etaMinDays: 3, etaMaxDays: 7, rateId: "a" });
  });

  it("pickup needs no address and costs nothing, but only when enabled", () => {
    const pickup: MethodRules = { method: "pickup", enabled: true, etaMinDays: null, etaMaxDays: null, note: "گالری", rates: [] };
    expect(quoteMethod(pickup, null, 10)).toMatchObject({ available: true, feeToman: 0, free: false, note: "گالری", rateId: null });
    expect(quoteMethod({ ...pickup, enabled: false }, null, 10)).toMatchObject({ available: false, reason: "disabled" });
  });
});

describe("free shipping policy", () => {
  const rule: FreeShippingRule = { enabled: true, thresholdToman: 2_000_000, methods: ["post", "local_courier"] };
  const priced = (method: "post" | "tipax" = "post") => quoteMethod({ ...post([rate("a", { provinces: ["تهران"] })]), method }, tehran, 10);

  it("waives the fee exactly at the threshold, not a Toman before", () => {
    expect(applyFreeShipping(priced(), rule, 1_999_999)).toMatchObject({ feeToman: 100_000, free: false });
    expect(applyFreeShipping(priced(), rule, 2_000_000)).toMatchObject({ feeToman: 0, free: true });
    expect(applyFreeShipping(priced(), rule, 9_000_000_000_000)).toMatchObject({ feeToman: 0, free: true });
  });

  it("only for the methods the owner chose", () => {
    expect(applyFreeShipping(priced("tipax"), rule, 5_000_000)).toMatchObject({ feeToman: 100_000, free: false });
  });

  it("never when switched off (whatever the stored threshold), and never with a missing threshold or no methods", () => {
    expect(applyFreeShipping(priced(), { ...rule, enabled: false }, 9_000_000)).toMatchObject({ feeToman: 100_000, free: false });
    expect(applyFreeShipping(priced(), { ...rule, thresholdToman: null }, 9_000_000)).toMatchObject({ free: false });
    expect(applyFreeShipping(priced(), { ...rule, methods: [] }, 9_000_000)).toMatchObject({ free: false });
  });

  it("never invents coverage: a destination that is not served stays unavailable", () => {
    const away = quoteMethod(post([rate("a", { provinces: ["فارس"] })]), tehran, 10);
    expect(applyFreeShipping(away, rule, 9_000_000)).toEqual({ method: "post", available: false, reason: "not_served" });
  });

  it("leaves pickup alone", () => {
    const pickup = quoteMethod({ method: "pickup", enabled: true, etaMinDays: null, etaMaxDays: null, note: null, rates: [] }, null, 1);
    expect(applyFreeShipping(pickup, { ...rule, methods: ["pickup"] }, 9_000_000)).toMatchObject({ feeToman: 0, free: false });
  });

  it("tells the shopper how much more to buy", () => {
    expect(freeShippingProgress(rule, 1_550_000)).toEqual({ enabled: true, thresholdToman: 2_000_000, methods: ["post", "local_courier"], remainingToman: 450_000, qualified: false });
    expect(freeShippingProgress(rule, 2_000_000)).toMatchObject({ remainingToman: 0, qualified: true });
    expect(freeShippingProgress({ ...rule, enabled: false }, 1)).toEqual({ enabled: false, thresholdToman: null, methods: [], remainingToman: null, qualified: false });
  });
});

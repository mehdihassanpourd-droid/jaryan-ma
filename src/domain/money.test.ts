import { describe, expect, it } from "vitest";
import { MAX_TOMAN, MoneyRangeError, bigintToSafeNumber, isToman, lineTotal, sumToman, tomanFromDb, tomanFromDbOrNull, tomanToDb, tomanToDbOrNull } from "./money";

describe("money range", () => {
  it("keeps the supported range exact in JSON numbers", () => {
    expect(MAX_TOMAN).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(MAX_TOMAN)).toBe(true);
    // The whole point: every supported amount survives a JSON round trip unchanged.
    for (const n of [0, 1, 2_147_483_647, 2_147_483_648, 5_000_000_000_000, 999_999_999_999_999, MAX_TOMAN]) {
      expect(JSON.parse(JSON.stringify({ n })).n).toBe(n);
    }
  });

  it("shows why larger numbers are refused: JSON would corrupt them silently", () => {
    expect(JSON.parse("9007199254740993")).toBe(9007199254740992); // off by one, no error
    expect(isToman(9_007_199_254_740_993)).toBe(false);
    expect(isToman(MAX_TOMAN + 1)).toBe(false);
  });

  it.each([0, 1, 1500000, 2_147_483_648, MAX_TOMAN])("accepts %i", (n) => expect(isToman(n)).toBe(true));
  it.each([-1, 1.5, NaN, Infinity, "5", null, undefined, 1n, MAX_TOMAN + 1])("rejects %s", (n) => expect(isToman(n)).toBe(false));
});

describe("database conversion", () => {
  it("round-trips amounts above the 32-bit limit exactly", () => {
    for (const n of [0, 2_147_483_647, 2_147_483_648, 12_345_678_901_234, MAX_TOMAN]) {
      const db = tomanToDb(n);
      expect(typeof db).toBe("bigint");
      expect(tomanFromDb(db)).toBe(n);
    }
  });

  it("never rounds: out-of-range values throw in both directions", () => {
    expect(() => tomanToDb(MAX_TOMAN + 1)).toThrow(MoneyRangeError);
    expect(() => tomanToDb(1.5)).toThrow(MoneyRangeError);
    expect(() => tomanToDb(-1)).toThrow(MoneyRangeError);
    expect(() => tomanFromDb(BigInt(MAX_TOMAN) + 1n)).toThrow(MoneyRangeError); // corrupt/foreign data
    expect(() => tomanFromDb(-1n)).toThrow(MoneyRangeError);
    expect(() => tomanFromDb(9_223_372_036_854_775_807n)).toThrow(MoneyRangeError);
  });

  it("handles null", () => {
    expect(tomanToDbOrNull(null)).toBeNull();
    expect(tomanFromDbOrNull(null)).toBeNull();
    expect(tomanToDbOrNull(5)).toBe(5n);
    expect(tomanFromDbOrNull(5n)).toBe(5);
  });
});

describe("order arithmetic", () => {
  it("multiplies exactly even when the product exceeds 2^53", () => {
    expect(lineTotal(MAX_TOMAN, 1000)).toBe(1_000_000_000_000_000_000n);
    // 999,999,999,999,999 x 999 = 998,999,999,999,999,001: odd, above 2^53, so a double cannot represent it.
    const exact = lineTotal(999_999_999_999_999, 999);
    expect(exact).toBe(998_999_999_999_999_001n);
    expect(BigInt(Number(exact))).not.toBe(exact);
    expect(lineTotal(1_500_000, 3)).toBe(4_500_000n);
  });

  it("rejects invalid inputs", () => {
    expect(() => lineTotal(-1, 1)).toThrow(MoneyRangeError);
    expect(() => lineTotal(10, 0)).toThrow(MoneyRangeError);
    expect(() => lineTotal(10, 1.5)).toThrow(MoneyRangeError);
  });

  it("sums exactly and refuses totals beyond the supported range", () => {
    expect(sumToman([4_500_000n, 2_000_000_000_000n])).toBe(2_000_004_500_000);
    expect(sumToman([])).toBe(0);
    expect(() => sumToman([BigInt(MAX_TOMAN), 1n])).toThrow("order_total_out_of_range");
  });

  it("converts sizes safely", () => {
    expect(bigintToSafeNumber(5_000_000_000n)).toBe(5_000_000_000);
    expect(() => bigintToSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(MoneyRangeError);
  });
});

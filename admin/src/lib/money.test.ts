import { describe, expect, it } from "vitest";
import { MAX_TOMAN } from "@/domain/money";
import { parsePrice, parseWhole, priceToInput } from "./money";

describe("price parsing keeps whole-Toman precision (BigInt-exact)", () => {
  it("accepts Persian and Arabic digits and separators", () => {
    expect(parsePrice("۴٬۵۰۰٬۰۰۰")).toEqual({ ok: true, value: 4_500_000 });
    expect(parsePrice("٤٥٠٠")).toEqual({ ok: true, value: 4500 });
    expect(parsePrice(" 1,234,567 تومان ")).toEqual({ ok: true, value: 1_234_567 });
  });
  it("empty means 'not announced'", () => {
    expect(parsePrice("")).toEqual({ ok: true, value: null });
    expect(parsePrice("   ")).toEqual({ ok: true, value: null });
  });
  it("the maximum is exact and one above is refused, never rounded", () => {
    expect(parsePrice(String(MAX_TOMAN))).toEqual({ ok: true, value: MAX_TOMAN });
    expect(parsePrice("۱٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۰")).toEqual({ ok: true, value: MAX_TOMAN });
    expect(parsePrice(String(BigInt(MAX_TOMAN) + 1n))).toEqual({ ok: false, reason: "too_large" });
    expect(parsePrice("9007199254740993")).toEqual({ ok: false, reason: "too_large" });
    expect(parsePrice("99999999999999999999999")).toEqual({ ok: false, reason: "too_large" });
  });
  it("round-trips the largest values through the field text", () => {
    for (const value of [0, 1, 999_999_999_999_999, MAX_TOMAN]) {
      expect(parsePrice(priceToInput(value))).toEqual({ ok: true, value });
    }
  });
  it("refuses decimals, exponents, signs and text", () => {
    for (const bad of ["12.5", "1e15", "-5", "+5", "12a", "۱۲٫۵", "0x10", "NaN"]) {
      expect(parsePrice(bad), bad).toEqual({ ok: false, reason: "invalid" });
    }
  });
  it("counts have their own ceiling", () => {
    expect(parseWhole("366", 365)).toEqual({ ok: false, reason: "too_large" });
    expect(parseWhole("365", 365)).toEqual({ ok: true, value: 365 });
  });
});

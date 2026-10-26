import { describe, expect, it } from "vitest";
import { formatNumber, formatToman } from "./format";

describe("formatNumber", () => {
  it("uses Persian digits", () => {
    expect(formatNumber(12)).toBe("۱۲");
  });
});

describe("formatToman", () => {
  it("returns null when no price is announced", () => {
    expect(formatToman(null)).toBeNull();
    expect(formatToman(undefined)).toBeNull();
  });

  it("appends the Toman unit", () => {
    expect(formatToman(1000)).toContain("تومان");
    expect(formatToman(1000)).toContain("۱");
  });
});

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

  it("formats very large amounts exactly (number and bigint)", () => {
    expect(formatToman(999_999_999_999_999)).toBe("۹۹۹٬۹۹۹٬۹۹۹٬۹۹۹٬۹۹۹ تومان");
    expect(formatToman(5_000_000_000_000)).toBe("۵٬۰۰۰٬۰۰۰٬۰۰۰٬۰۰۰ تومان");
    expect(formatToman(2n ** 63n - 1n)).toBe("۹٬۲۲۳٬۳۷۲٬۰۳۶٬۸۵۴٬۷۷۵٬۸۰۷ تومان"); // bigint: exact beyond 2^53
  });

  it("appends the Toman unit", () => {
    expect(formatToman(1000)).toContain("تومان");
    expect(formatToman(1000)).toContain("۱");
  });
});

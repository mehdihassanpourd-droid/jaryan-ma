import { describe, expect, it } from "vitest";
import { fixPersianLetters, normalizeForSearch, parseToman, slugify, toLatinDigits } from "./persian";

describe("toLatinDigits", () => {
  it("converts Persian and Arabic-Indic digits", () => {
    expect(toLatinDigits("۱۲۳۴۵۶۷۸۹۰")).toBe("1234567890");
    expect(toLatinDigits("٠١٢٣")).toBe("0123");
    expect(toLatinDigits("abc ۷")).toBe("abc 7");
  });
});

describe("fixPersianLetters", () => {
  it("replaces Arabic yeh/kaf and keeps ZWNJ", () => {
    expect(fixPersianLetters("  كيف مى‌شود ")).toBe("کیف می‌شود");
  });
});

describe("normalizeForSearch", () => {
  it("makes spelling variants comparable", () => {
    expect(normalizeForSearch("می‌شود")).toBe(normalizeForSearch("ميشود"));
    expect(normalizeForSearch("ماکرومه ۲")).toBe("ماکرومه 2");
    expect(normalizeForSearch("  Wall   HANGING ")).toBe("wall hanging");
  });
});

describe("parseToman", () => {
  it.each([
    ["۱٬۲۰۰٬۰۰۰", 1200000],
    ["1,200,000", 1200000],
    ["۱۲۰۰۰۰۰ تومان", 1200000],
    ["  ۵۰۰ ", 500],
    ["0", 0],
    [1500, 1500],
  ])("parses %s", (input, expected) => {
    expect(parseToman(input)).toBe(expected);
  });

  it.each(["", "abc", "12.5", "-5", "۱۲a", "1e3", "٫٥"])("rejects %j", (input) => {
    expect(parseToman(input)).toBeNull();
  });

  it("rejects non-integers, negatives and unsafe numbers", () => {
    expect(parseToman(1.5)).toBeNull();
    expect(parseToman(-1)).toBeNull();
    expect(parseToman(Number.MAX_SAFE_INTEGER + 2)).toBeNull();
    expect(parseToman(null)).toBeNull();
    expect(parseToman(undefined)).toBeNull();
  });
});

describe("slugify", () => {
  it("keeps Persian letters and uses ASCII digits", () => {
    expect(slugify("ماکرومه قوسی ۲")).toBe("ماکرومه-قوسی-2");
    expect(slugify("دیوارکوب‌ بافته")).toBe("دیوارکوب-بافته");
  });
  it("handles latin text, punctuation and edges", () => {
    expect(slugify("  Hello, World!! ")).toBe("hello-world");
    expect(slugify("---")).toBe("");
    expect(slugify("a".repeat(200), 10)).toHaveLength(10);
  });
});

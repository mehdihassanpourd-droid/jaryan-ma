/**
 * Persian text helpers shared by the storefront, the admin UI (browser) and the
 * admin API (Worker). Pure functions only: no DOM, Node or Workers APIs.
 */

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Converts Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII digits. */
export function toLatinDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (ch) => {
    const persian = PERSIAN_DIGITS.indexOf(ch);
    return String(persian >= 0 ? persian : ARABIC_DIGITS.indexOf(ch));
  });
}

/**
 * Fixes the Arabic look-alike letters that Arabic keyboards produce
 * (ي ى ك) and trims. Keeps ZWNJ, so it is safe for text that is stored and shown.
 */
export function fixPersianLetters(input: string): string {
  return input.normalize("NFC").replace(/[يى]/g, "ی").replace(/ك/g, "ک").trim();
}

/** Aggressive normalisation for matching only (search text, slugs); never display this. */
export function normalizeForSearch(input: string): string {
  return toLatinDigits(
    fixPersianLetters(input.normalize("NFKC"))
      .replace(/[ً-ٰٟـ]/g, "") // harakat, superscript alef, tatweel
      .replace(/[‌‍]/g, "") // ZWNJ / ZWJ
      .replace(/\s+/g, " "),
  )
    .toLowerCase()
    .trim();
}

/**
 * Parses a price typed by a person, e.g. "۱٬۲۰۰٬۰۰۰", "1,200,000" or "۱۲۰۰۰۰۰ تومان".
 * Returns a non-negative integer, or `null` when the text is not a whole number.
 * Decimals are rejected on purpose: Toman amounts are integers.
 */
export function parseToman(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isSafeInteger(input) && input >= 0 ? input : null;
  const cleaned = toLatinDigits(input)
    .replace(/تومان/g, "")
    .replace(/[\s,٬،]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

/** URL slug that keeps Persian letters: "ماکرومه قوسی ۲" -> "ماکرومه-قوسی-2". */
export function slugify(input: string, maxLength = 80): string {
  return normalizeForSearch(input.replace(/[‌‍]/g, " "))
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

/** Escapes `%`, `_` and `\` so user text can be used inside a SQL LIKE pattern. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

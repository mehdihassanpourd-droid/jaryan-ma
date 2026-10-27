import { MAX_TOMAN } from "@/domain/money";
import { toLatinDigits } from "@/domain/persian";
import { formatNumber } from "@/lib/format";

/**
 * Prices are whole Toman up to MAX_TOMAN (10^15). Form fields keep prices as TEXT and parse them exactly with
 * BigInt: a value is only ever turned into a number after it has been proven to be a safe integer in range, so
 * nothing is silently rounded (a Number would not represent 10^16+ exactly, and 1e15 would be accepted as a float).
 */
export type NumberParse = { ok: true; value: number | null } | { ok: false; reason: "invalid" | "too_large" };

function digitsOf(text: string): string | null {
  const cleaned = toLatinDigits(text)
    .replace(/تومان/g, "")
    .replace(/[\s,٬،'’_]/g, "");
  return /^\d+$/.test(cleaned) ? cleaned : null;
}

/** Empty -> null (not announced). Persian/Arabic digits and thousands separators are fine; decimals, signs and exponents are not. */
export function parseWhole(text: string, max: number): NumberParse {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  const digits = digitsOf(trimmed);
  if (digits === null) return { ok: false, reason: "invalid" };
  const value = BigInt(digits);
  if (value > BigInt(max)) return { ok: false, reason: "too_large" };
  return { ok: true, value: Number(value) }; // exact: max <= MAX_TOMAN < 2^53
}

export const parsePrice = (text: string): NumberParse => parseWhole(text, MAX_TOMAN);

/** Persian digits with thousands separators, e.g. ۴٬۵۰۰٬۰۰۰ (what the field shows after editing). */
export const priceToInput = (value: number | null): string => (value === null ? "" : formatNumber(value));

/** Plain digits for fields that are not prices (inventory, lead time). */
export const countToInput = (value: number | null): string => (value === null ? "" : String(value));

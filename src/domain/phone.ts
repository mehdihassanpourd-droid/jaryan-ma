import { toLatinDigits } from "./persian";

/**
 * Normalises an Iranian mobile number typed in any common form to E.164 (`+989XXXXXXXXX`), or null.
 * Accepts Persian/Arabic digits and: 09121234567, 9121234567, +98 912 123 4567, 0098-912-..., 989121234567.
 * Landlines, other countries and obviously fake numbers (one repeated digit) are rejected.
 */
export function normalizeIranMobile(input: string): string | null {
  const raw = toLatinDigits(input).trim();
  if (raw.length === 0 || raw.length > 30 || !/^\+?[\d\s\-().]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && !digits.startsWith("98")) return null;
  if (digits.startsWith("0098")) digits = digits.slice(4);
  else if (digits.startsWith("98") && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  if (!/^9\d{9}$/.test(digits) || /^(\d)\1{9}$/.test(digits)) return null;
  return `+98${digits}`;
}

export const E164_IRAN_MOBILE = /^\+989\d{9}$/;

/** `+989121234567` -> `+98912***4567`, for logs and screens. */
export function maskPhone(e164: string): string {
  return E164_IRAN_MOBILE.test(e164) ? `${e164.slice(0, 6)}***${e164.slice(-4)}` : "***";
}

/** `+989121234567` -> `09121234567` (how people read it). */
export function toNationalFormat(e164: string): string {
  return E164_IRAN_MOBILE.test(e164) ? `0${e164.slice(3)}` : e164;
}

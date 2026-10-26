import { toLatinDigits } from "../persian";

/** The 31 provinces of Iran, as written in Persian addresses. */
export const IRAN_PROVINCES = [
  "آذربایجان شرقی", "آذربایجان غربی", "اردبیل", "اصفهان", "البرز", "ایلام", "بوشهر", "تهران",
  "چهارمحال و بختیاری", "خراسان جنوبی", "خراسان رضوی", "خراسان شمالی", "خوزستان", "زنجان", "سمنان",
  "سیستان و بلوچستان", "فارس", "قزوین", "قم", "کردستان", "کرمان", "کرمانشاه", "کهگیلویه و بویراحمد",
  "گلستان", "گیلان", "لرستان", "مازندران", "مرکزی", "هرمزگان", "همدان", "یزد",
] as const;
export type IranProvince = (typeof IRAN_PROVINCES)[number];

export const isIranProvince = (value: string): value is IranProvince => (IRAN_PROVINCES as readonly string[]).includes(value);

/**
 * Iranian postal codes have 10 digits: the first four never contain 0 or 2 and do not start with four
 * identical digits, the fifth is never 0, 2 or 5, and the rest never contain 2. Persian digits are accepted.
 */
const POSTAL_CODE = /^(?!(\d)\1{3})[13-9]{4}[1346-9][013-9]{5}$/;

export function normalizePostalCode(input: string): string | null {
  const digits = toLatinDigits(input).replace(/[\s-]/g, "");
  return POSTAL_CODE.test(digits) ? digits : null;
}

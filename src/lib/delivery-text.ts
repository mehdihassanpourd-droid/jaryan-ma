import { formatNumber, formatToman } from "./format";
import type { UnavailableReason } from "@/domain/shipping/pricing";

/** «حدود ۳ تا ۷ روز» from the owner's numbers; nothing when the owner gave none (no promise is invented). */
export function etaText(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  const lo = min ?? max;
  const hi = max ?? min;
  if (lo === null || hi === null) return null;
  return lo === hi ? `حدود ${formatNumber(lo)} روز` : `حدود ${formatNumber(lo)} تا ${formatNumber(hi)} روز`;
}

/** The fee as a shopper reads it: a price, or «رایگان». */
export const feeText = (feeToman: number): string => (feeToman === 0 ? "رایگان" : (formatToman(feeToman) ?? ""));

export const UNAVAILABLE_REASON_TEXT: Record<UnavailableReason, string> = {
  disabled: "",
  address_required: "پس از انتخاب استان و نوشتن شهر قیمت نمایش داده می‌شود.",
  not_served: "به این نشانی (یا با این وزن) ارسال نمی‌شود.",
};

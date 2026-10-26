const faNumber = new Intl.NumberFormat("fa-IR");

/** Formats an integer with Persian digits and thousands separators. */
export function formatNumber(value: number | bigint): string {
  return faNumber.format(value);
}

/**
 * Formats a Toman amount for display, e.g. `۱٬۲۰۰٬۰۰۰ تومان`.
 * Returns `null` when no price has been announced.
 */
export function formatToman(amount: number | bigint | null | undefined): string | null {
  if (amount == null) return null;
  return `${formatNumber(amount)} تومان`;
}

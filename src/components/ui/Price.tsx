import { formatToman } from "@/lib/format";

/** Shows a Toman price, or a neutral note when no price is announced. */
export function Price({ amount }: { amount: number | null }) {
  const text = formatToman(amount);
  if (!text) return <span className="text-sm text-bark-500">قیمت به‌زودی اعلام می‌شود</span>;
  return <span className="font-semibold text-bark-900">{text}</span>;
}

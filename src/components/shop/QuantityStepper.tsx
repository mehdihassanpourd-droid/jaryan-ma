import { formatNumber } from "@/lib/format";

/** −/+ control with 44px touch targets. The number is announced politely; the buttons name the product they change. */
export function QuantityStepper({ value, min = 1, max, label, onChange }: { value: number; min?: number; max: number; label: string; onChange: (next: number) => void }) {
  const btn = "flex h-11 w-11 items-center justify-center border border-sand-300 text-lg text-bark-800 hover:bg-sand-100 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="inline-flex items-center gap-2" role="group" aria-label={`تعداد ${label}`}>
      <button type="button" className={btn} disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`کم کردن تعداد ${label}`}>−</button>
      <output className="min-w-8 text-center font-semibold text-bark-900" aria-live="polite" data-testid="quantity">{formatNumber(value)}</output>
      <button type="button" className={btn} disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`افزودن تعداد ${label}`}>+</button>
    </div>
  );
}

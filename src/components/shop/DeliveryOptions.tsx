import { SHIPPING_METHOD_LABEL, SHIPPING_METHODS, type ShippingMethodKey } from "@/domain/shipping/methods";
import type { MethodQuote } from "@/domain/shipping/pricing";
import { etaText, feeText, UNAVAILABLE_REASON_TEXT } from "@/lib/delivery-text";

interface Props {
  quotes: MethodQuote[] | null;
  loading: boolean;
  failed: boolean;
  selected: ShippingMethodKey | null;
  onSelect: (method: ShippingMethodKey) => void;
  onRetry: () => void;
}

/** «روش ارسال»: every method the owner switched on, with the server's price, or the reason it cannot be chosen yet. */
export function DeliveryOptions({ quotes, loading, failed, selected, onSelect, onRetry }: Props) {
  const offered = (quotes ?? []).filter((q) => !(q.available === false && q.reason === "disabled"));
  return (
    <fieldset className="space-y-3" data-testid="delivery-options" aria-busy={loading}>
      <legend className="text-lg font-bold text-bark-900">روش ارسال</legend>
      {failed && (
        <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm leading-7 text-red-900">
          <p>محاسبهٔ هزینهٔ ارسال ممکن نشد.</p>
          <button type="button" onClick={onRetry} className="mt-2 min-h-11 underline">تلاش دوباره</button>
        </div>
      )}
      {!failed && quotes === null && <p role="status" className="text-sm text-bark-600">در حال محاسبهٔ هزینهٔ ارسال…</p>}
      {!failed && quotes !== null && offered.length === 0 && (
        <p role="status" className="rounded-xl border border-sand-300 bg-ivory-50 p-4 text-sm leading-7 text-bark-700" data-testid="no-delivery">
          در حال حاضر روش ارسالی برای ثبت سفارش در سایت فعال نیست. می‌توانید متن سفارش را بسازید و از راه اینستاگرام برای گالری بفرستید.
        </p>
      )}
      {offered
        .sort((a, b) => SHIPPING_METHODS.indexOf(a.method) - SHIPPING_METHODS.indexOf(b.method))
        .map((q) => {
          const id = `delivery-${q.method}`;
          const eta = q.available ? etaText(q.etaMinDays, q.etaMaxDays) : null;
          return (
            <label
              key={q.method}
              htmlFor={id}
              className={`flex items-start gap-3 rounded-2xl border p-4 ${q.available ? "cursor-pointer border-sand-300 bg-ivory-50 has-[:checked]:border-olive-700 has-[:checked]:bg-white" : "border-sand-200 bg-sand-100/60 text-bark-600"}`}
            >
              <input
                id={id}
                type="radio"
                name="delivery-method"
                value={q.method}
                checked={selected === q.method}
                disabled={!q.available}
                onChange={() => onSelect(q.method)}
                className="mt-1.5 h-5 w-5 accent-bark-700"
                data-testid={id}
              />
              <span className="flex-1 space-y-1">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-bark-900">{SHIPPING_METHOD_LABEL[q.method]}</span>
                  {q.available && (
                    <span className={q.feeToman === 0 && q.method !== "pickup" ? "font-bold text-olive-800" : "text-bark-900"} data-testid={`${id}-fee`}>
                      {q.method === "pickup" ? "بدون هزینه" : feeText(q.feeToman)}
                    </span>
                  )}
                </span>
                {q.available && q.free && <span className="block text-sm text-olive-800">ارسال رایگان برای این سفارش</span>}
                {eta && <span className="block text-sm text-bark-700">{eta}</span>}
                {q.available && q.note && <span className="block text-sm leading-7 text-bark-700">{q.note}</span>}
                {!q.available && <span className="block text-sm">{UNAVAILABLE_REASON_TEXT[q.reason]}</span>}
              </span>
            </label>
          );
        })}
    </fieldset>
  );
}

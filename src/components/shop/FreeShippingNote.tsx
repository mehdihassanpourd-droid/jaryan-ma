import { SHIPPING_METHOD_LABEL } from "@/domain/shipping/methods";
import { freeShippingProgress, type FreeShippingProgress } from "@/domain/shipping/pricing";
import { formatToman } from "@/lib/format";

/**
 * «با X تومان خرید بیشتر، ارسال رایگان می‌شود»: computed from the owner's policy and the cart's items subtotal. Only an
 * announcement: the delivery fee itself is always decided by the server when the order is placed.
 */
export function FreeShippingNote({ policy, subtotalToman }: { policy: FreeShippingProgress | null; subtotalToman: bigint }) {
  if (!policy || !policy.enabled || policy.thresholdToman === null) return null;
  const subtotal = Number(subtotalToman);
  const progress = freeShippingProgress({ enabled: true, thresholdToman: policy.thresholdToman, methods: policy.methods }, subtotal);
  const methods = policy.methods.map((m) => SHIPPING_METHOD_LABEL[m]).join("، ");
  const percent = Math.min(100, Math.floor((subtotal / policy.thresholdToman) * 100));
  return (
    <div className="mt-3 rounded-xl border border-sand-300 bg-white p-3 text-sm leading-7 text-bark-800" data-testid="free-shipping-note" data-qualified={progress.qualified ? "true" : "false"}>
      <p>
        {progress.qualified
          ? <>هزینهٔ ارسال با روش‌های <strong>{methods}</strong> برای این سفارش رایگان است.</>
          : <>با <strong data-testid="free-shipping-remaining">{formatToman(progress.remainingToman ?? 0)}</strong> خرید بیشتر، ارسال با روش‌های <strong>{methods}</strong> رایگان می‌شود.</>}
      </p>
      <div
        role="progressbar"
        aria-label="پیشرفت تا ارسال رایگان"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent} درصد از حداقل ${formatToman(policy.thresholdToman)}`}
        className="mt-2 h-2 overflow-hidden rounded-full bg-sand-200"
      >
        <div className="h-full rounded-full bg-olive-700" style={{ inlineSize: `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs text-bark-600">حداقل جمع کالاها: {formatToman(policy.thresholdToman)}. فقط برای مقصدهایی که روش ارسال دارند.</p>
    </div>
  );
}

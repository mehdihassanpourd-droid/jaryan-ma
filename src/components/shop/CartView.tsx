"use client";

import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { lineKey } from "@/lib/cart";
import { cartTotal, priceLine, quantityLimit, UNAVAILABLE_TEXT, type PricedLine } from "@/lib/cart-pricing";
import { formatNumber, formatToman } from "@/lib/format";
import { liveProductHref, safeImageUrl } from "@/lib/live-catalog";
import { LIVE_CATALOG_BASE } from "@/lib/live-config";
import { FreeShippingNote } from "./FreeShippingNote";
import { QuantityStepper } from "./QuantityStepper";
import { useCart } from "./useCart";
import { useCartProducts } from "./useCartProducts";
import { useFreeShippingPolicy } from "./useFreeShipping";

/** Honest status line used on the cart and the checkout: what this store can and cannot do today. */
export const NO_PAYMENT_NOTE = "پرداخت آنلاین هنوز فعال نیست و هیچ مبلغی از شما دریافت نمی‌شود.";

export function CartView() {
  const cart = useCart();
  const { products, retry } = useCartProducts(cart.lines.map((l) => l.slug));
  const freeShipping = useFreeShippingPolicy();

  if (!LIVE_CATALOG_BASE) return <Shell><p className="rounded-2xl border border-sand-300 bg-ivory-50 p-6 text-bark-700">سبد خرید فقط برای فروشگاه متصل به فهرست محصولات کار می‌کند.</p></Shell>;
  if (!cart.hydrated) return <Shell><p role="status" className="text-bark-600">در حال بارگذاری سبد خرید…</p></Shell>;
  if (cart.lines.length === 0) {
    return (
      <Shell>
        <p role="status" className="rounded-2xl border border-sand-300 bg-ivory-50 p-6 text-bark-700">سبد خرید شما خالی است.</p>
        <p className="mt-6"><ButtonLink href="/#featured">دیدن آثار</ButtonLink></p>
      </Shell>
    );
  }
  if (products.state === "loading") return <Shell><p role="status" className="text-bark-600">در حال بررسی قیمت و موجودی…</p></Shell>;
  if (products.state === "error") {
    return (
      <Shell>
        <div role="alert" className="rounded-2xl border border-sand-300 bg-ivory-50 p-6 text-bark-700">
          <p>در حال حاضر بررسی قیمت و موجودی ممکن نیست؛ سبد شما حفظ شده است.</p>
          <button type="button" onClick={retry} className="mt-4 inline-flex min-h-11 items-center rounded-full border border-bark-500/40 px-5 text-sm text-bark-700 hover:bg-sand-100">تلاش دوباره</button>
        </div>
      </Shell>
    );
  }

  const priced: PricedLine[] = cart.lines.map((line) => priceLine(line, products.value.get(line.slug) ?? null));
  const orderable = priced.filter((p) => p.ok);
  const total = cartTotal(priced);

  return (
    <Shell>
      <ul className="divide-y divide-sand-200 rounded-2xl border border-sand-200 bg-ivory-50" aria-label="کالاهای سبد خرید" data-testid="cart-lines">
        {priced.map((p) => (
          <CartLineRow key={lineKey(p.line)} priced={p} onQuantity={(q) => cart.setQuantity(lineKey(p.line), q)} onRemove={() => cart.remove(lineKey(p.line))} />
        ))}
      </ul>

      <section aria-label="جمع سبد خرید" className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] -mx-5 mt-6 border-t border-sand-200 bg-ivory-50/95 px-5 py-4 backdrop-blur sm:static sm:mx-0 sm:rounded-2xl sm:border sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-bark-600">جمع کل ({formatNumber(orderable.reduce((n, p) => n + (p.ok ? p.quantity : 0), 0))} کالا)</p>
            <p className="text-xl font-bold text-bark-900" data-testid="cart-total">{formatToman(total)}</p>
          </div>
          {orderable.length > 0 ? (
            <ButtonLink href="/checkout" size="lg">ادامه و تکمیل سفارش</ButtonLink>
          ) : (
            <span aria-disabled="true" className="inline-flex cursor-not-allowed items-center rounded-full bg-sand-300 px-7 py-3.5 text-base font-medium text-bark-600">کالای قابل سفارشی در سبد نیست</span>
          )}
        </div>
        {orderable.length > 0 && <FreeShippingNote policy={freeShipping} subtotalToman={total} />}
        <p className="mt-3 text-xs leading-6 text-bark-600">هزینهٔ ارسال در این مبلغ لحاظ نشده است. {NO_PAYMENT_NOTE}</p>
        {priced.some((p) => !p.ok) && <p className="mt-2 text-xs leading-6 text-bark-700">کالاهای ناموجود یا حذف‌شده در جمع کل حساب نمی‌شوند و سفارش داده نخواهند شد.</p>}
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Container className="py-10 sm:py-14">
      <h1 className="text-2xl font-bold text-bark-900 sm:text-3xl">سبد خرید</h1>
      <div className="mt-8">{children}</div>
    </Container>
  );
}

function CartLineRow({ priced, onQuantity, onRemove }: { priced: PricedLine; onQuantity: (q: number) => void; onRemove: () => void }) {
  const { line, product } = priced;
  const name = product?.name ?? line.slug;
  const image = product?.images[0] ? safeImageUrl(product.images[0].url) : null;
  const unavailable = !priced.ok;
  return (
    <li className={`flex gap-4 p-4 ${unavailable ? "bg-sand-100/60" : ""}`} data-testid="cart-line" data-available={unavailable ? "false" : "true"}>
      <div className="h-24 w-20 shrink-0 overflow-hidden rounded-xl bg-sand-100 ring-1 ring-sand-200">
        {image && (
          // eslint-disable-next-line @next/next/no-img-element -- static export: no image optimiser
          <img src={image} alt={product?.images[0]?.alt || name} className={`h-full w-full object-cover ${unavailable ? "opacity-50" : ""}`} />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {product ? <Link href={liveProductHref(line.slug)} className="font-semibold leading-7 text-bark-900 hover:underline">{name}</Link> : <span className="font-semibold text-bark-700" dir="ltr">{name}</span>}
            {priced.ok && priced.variantLabel && <p className="text-sm text-bark-600">{priced.variantLabel}</p>}
            {priced.ok && priced.madeToOrder && <p className="text-xs text-bark-600">ساخت پس از سفارش{product?.leadTimeDays ? ` (حدود ${formatNumber(product.leadTimeDays)} روز)` : ""}</p>}
          </div>
          <button type="button" onClick={onRemove} aria-label={`حذف ${name} از سبد`} className="shrink-0 rounded-full px-3 py-2 text-sm text-bark-700 underline hover:text-bark-900">حذف</button>
        </div>
        {priced.ok ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {quantityLimit(priced.product) > 1 ? (
              <QuantityStepper value={priced.quantity} max={quantityLimit(priced.product)} label={name} onChange={onQuantity} />
            ) : (
              <span className="text-sm text-bark-600">اثر یگانه: یک عدد</span>
            )}
            <div className="text-end">
              <p className="text-xs text-bark-600">{formatToman(priced.unitPriceToman)}{priced.quantity > 1 ? ` × ${formatNumber(priced.quantity)}` : ""}</p>
              <p className="font-semibold text-bark-900" data-testid="line-total">{formatToman(priced.totalToman)}</p>
            </div>
          </div>
        ) : (
          <p role="status" className="text-sm font-medium text-red-800" data-testid="line-problem">{UNAVAILABLE_TEXT[priced.reason]}</p>
        )}
      </div>
    </li>
  );
}

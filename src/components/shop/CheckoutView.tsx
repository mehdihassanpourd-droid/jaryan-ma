"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Container } from "@/components/ui/Container";
import type { LineProblem } from "@/domain/customer/checkout";
import { lineKey } from "@/lib/cart";
import { cartTotal, priceLine, UNAVAILABLE_TEXT, type PricedLine } from "@/lib/cart-pricing";
import { emptyShippingForm, formFromAddress, PROVINCES, validateShipping, type ShippingErrors, type ShippingForm } from "@/lib/checkout-form";
import { formatNumber, formatToman } from "@/lib/format";
import { LIVE_CATALOG_BASE } from "@/lib/live-config";
import { OrderApiError } from "@/lib/order-api";
import { buildOrderText } from "@/lib/order-text";
import { newRequestId } from "@/lib/request-id";
import { site } from "@/lib/site";
import { Field } from "./Field";
import { NO_PAYMENT_NOTE } from "./CartView";
import { orderApi } from "./orderClient";
import { SignInPanel } from "./SignInPanel";
import { useCart } from "./useCart";
import { useCartProducts } from "./useCartProducts";
import { useCustomer } from "./useCustomer";

const primary = "inline-flex min-h-12 items-center justify-center rounded-full bg-bark-700 px-7 py-3 text-base font-medium text-ivory-50 hover:bg-bark-900 disabled:cursor-not-allowed disabled:opacity-60";
const secondary = "inline-flex min-h-12 items-center justify-center rounded-full border border-bark-500/40 px-7 py-3 text-base font-medium text-bark-700 hover:bg-sand-100 disabled:cursor-not-allowed disabled:opacity-60";

const LINE_REASON_TEXT: Record<LineProblem["reason"], string> = {
  not_found: UNAVAILABLE_TEXT.not_found,
  variant_required: "یک گزینه را انتخاب کنید.",
  variant_not_found: UNAVAILABLE_TEXT.variant_not_found,
  sold_out: UNAVAILABLE_TEXT.sold_out,
  insufficient_stock: "موجودی کافی نیست.",
  quantity_not_allowed: "تعداد درخواستی مجاز نیست.",
  no_price: UNAVAILABLE_TEXT.no_price,
};

function failureText(error: unknown): string {
  if (!(error instanceof OrderApiError)) return "خطایی رخ داد؛ سفارشی ثبت نشد. دوباره تلاش کنید.";
  switch (error.code) {
    case "network": return "ارتباط با سرور برقرار نشد. اگر سفارش ثبت شده باشد، با تلاش دوباره سفارش تکراری ساخته نمی‌شود.";
    case "unauthorized": return "ورود شما منقضی شده است؛ دوباره وارد شوید.";
    case "bad_csrf_token": case "bad_origin": return "نشست شما تازه‌سازی شد؛ دوباره دکمهٔ ثبت سفارش را بزنید.";
    case "too_many_open_orders": return "شما سفارش‌های باز زیادی دارید. بعد از رسیدگی گالری به آن‌ها دوباره سفارش دهید.";
    case "order_total_out_of_range": return "مبلغ سفارش از حد مجاز بیشتر است؛ تعداد را کم کنید.";
    case "account_not_active": return "این حساب در حال حاضر امکان ثبت سفارش ندارد.";
    case "rate_limited": return `درخواست‌های پشت‌سرهم زیاد بود؛ ${error.detail.retryAfterSeconds ?? 60} ثانیه دیگر دوباره تلاش کنید.`;
    default: return "سفارش ثبت نشد. اطلاعات را بررسی کنید و دوباره تلاش کنید.";
  }
}

export function CheckoutView() {
  const router = useRouter();
  const cart = useCart();
  const { products, retry: refreshProducts } = useCartProducts(cart.lines.map((l) => l.slug));
  const customer = useCustomer();
  const [form, setForm] = useState<ShippingForm>(emptyShippingForm);
  const [errors, setErrors] = useState<ShippingErrors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [lineProblems, setLineProblems] = useState<LineProblem[]>([]);
  const [saveAddress, setSaveAddress] = useState(false);
  const [smsDown, setSmsDown] = useState(false);
  const [orderText, setOrderText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [requestId] = useState(newRequestId);
  const prefilled = useRef(false);

  // A signed-in customer's default address fills the form once (never over what the person has already typed).
  const signedIn = customer.state.status === "signedIn";
  useEffect(() => {
    if (!orderApi || !signedIn || prefilled.current) return;
    prefilled.current = true;
    orderApi.addresses().then(
      (list) => {
        const address = list.find((a) => a.isDefault) ?? list[0];
        if (address) setForm((current) => (current.recipientName === "" && current.street === "" ? formFromAddress(address) : current));
      },
      () => undefined,
    );
  }, [signedIn]);

  const shell = (children: React.ReactNode) => (
    <Container className="py-10 sm:py-14">
      <h1 className="text-2xl font-bold text-bark-900 sm:text-3xl">تکمیل سفارش</h1>
      <div className="mt-8 space-y-8">{children}</div>
    </Container>
  );

  if (!LIVE_CATALOG_BASE) return shell(<p className="rounded-2xl border border-sand-300 bg-ivory-50 p-6 text-bark-700">ثبت سفارش فقط برای فروشگاه متصل به فهرست محصولات کار می‌کند.</p>);
  if (!cart.hydrated) return shell(<p role="status" className="text-bark-600">در حال بارگذاری…</p>);
  if (cart.lines.length === 0) {
    return shell(
      <div className="rounded-2xl border border-sand-300 bg-ivory-50 p-6">
        <p role="status" className="text-bark-700">سبد خرید شما خالی است.</p>
        <p className="mt-4"><Link href="/#featured" className="text-olive-700 underline">دیدن آثار</Link></p>
      </div>,
    );
  }
  if (products.state === "loading") return shell(<p role="status" className="text-bark-600">در حال بررسی قیمت و موجودی…</p>);
  if (products.state === "error") {
    return shell(
      <div role="alert" className="rounded-2xl border border-sand-300 bg-ivory-50 p-6 text-bark-700">
        <p>در حال حاضر بررسی قیمت و موجودی ممکن نیست؛ سبد شما حفظ شده است.</p>
        <button type="button" onClick={refreshProducts} className={`${secondary} mt-4`}>تلاش دوباره</button>
      </div>,
    );
  }

  const priced: PricedLine[] = cart.lines.map((line) => priceLine(line, products.value.get(line.slug) ?? null));
  const orderable = priced.filter((p): p is Extract<PricedLine, { ok: true }> => p.ok);
  if (orderable.length === 0) {
    return shell(
      <div className="rounded-2xl border border-sand-300 bg-ivory-50 p-6">
        {/* If this page just tried to place an order that the server refused, say why: otherwise the explanation would vanish with the form. */}
        {failure && (
          <div role="alert" data-testid="checkout-failure" className="mb-4 rounded-xl bg-red-50 p-4 text-sm leading-7 text-red-900">
            <p>{failure}</p>
            {lineProblems.length > 0 && (
              <ul className="mt-2 list-disc ps-5">
                {lineProblems.map((p) => (
                  <li key={`${p.slug}|${p.sku ?? ""}`}>{products.value.get(p.slug)?.name ?? p.slug}: {LINE_REASON_TEXT[p.reason]}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p role="status" className="text-bark-700">کالای قابل سفارشی در سبد شما نیست.</p>
        <p className="mt-4"><Link href="/cart" className="text-olive-700 underline">بازگشت به سبد خرید</Link></p>
      </div>,
    );
  }
  const total = cartTotal(priced);

  const real = orderApi !== null;
  const reachable = customer.state.status !== "unreachable";
  const showForm = !real || signedIn || smsDown || !reachable;
  const canPlace = real && signedIn;

  // Editing a field retires ITS error message: it described the old text, and a filled-in field must not keep saying "required".
  const set = (key: keyof ShippingForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((current) => (current[key] === undefined ? current : { ...current, [key]: undefined }));
  };
  const fieldProps = (key: keyof ShippingForm) => ({ value: form[key], onChange: set(key) });

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!orderApi) return;
    setFailure(null);
    setLineProblems([]);
    const checked = validateShipping(form);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    setBusy(true);
    try {
      const placed = await orderApi.placeOrder({
        items: orderable.map((p) => ({ slug: p.line.slug, sku: p.line.sku, quantity: p.quantity })),
        shipping: checked.shipping,
        customerNote: checked.customerNote,
        requestId,
      });
      if (saveAddress) await orderApi.createAddress({ ...checked.shipping, isDefault: false }).catch(() => undefined);
      cart.clear();
      router.push(`/order?number=${placed.order.number}`);
    } catch (error) {
      setFailure(failureText(error));
      if (error instanceof OrderApiError) {
        if (error.code === "items_unavailable") {
          setLineProblems(error.detail.items ?? []);
          refreshProducts();
        }
        if (error.status === 401 || error.code === "bad_csrf_token") customer.retry();
        if (error.status === 422) {
          const next: ShippingErrors = {};
          for (const issue of error.detail.issues ?? []) {
            const field = issue.path.startsWith("shipping.") ? (issue.path.slice(9) as keyof ShippingForm) : null;
            if (field && field in form) next[field] = "مقدار واردشده معتبر نیست.";
          }
          setErrors(next);
        }
      }
      setBusy(false);
    }
  }

  function makeText(e: React.MouseEvent) {
    e.preventDefault();
    const checked = validateShipping(form);
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    setCopied(false);
    setOrderText(buildOrderText(priced, total, checked.shipping, checked.customerNote));
  }

  async function copyText() {
    if (!orderText) return;
    try {
      await navigator.clipboard.writeText(orderText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return shell(
    <>
      {real ? (
        <p role="note" className="rounded-2xl border border-sand-300 bg-ivory-50 p-4 text-sm leading-7 text-bark-700">
          سفارش شما با وضعیت «در انتظار تأیید» ثبت می‌شود. {NO_PAYMENT_NOTE}
        </p>
      ) : (
        <div role="note" data-testid="demo-banner" className="rounded-2xl border-2 border-dashed border-olive-700 bg-ivory-50 p-4 text-sm leading-7 text-bark-800">
          <strong>حالت آزمایشی:</strong> این فروشگاه هنوز به سامانهٔ ثبت سفارش متصل نیست؛ در این صفحه <strong>هیچ سفارشی ثبت نمی‌شود</strong>. می‌توانید اطلاعات را وارد کنید و متن سفارش را بسازید تا از راه اینستاگرام برای گالری بفرستید. {NO_PAYMENT_NOTE}
        </div>
      )}

      <section aria-labelledby="summary-title" className="rounded-2xl border border-sand-200 bg-ivory-50 p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="summary-title" className="text-lg font-bold text-bark-900">خلاصهٔ سفارش</h2>
          <Link href="/cart" className="text-sm text-olive-700 underline">ویرایش سبد</Link>
        </div>
        <ul className="mt-4 divide-y divide-sand-200" data-testid="summary-lines">
          {priced.map((p) => {
            const problem = lineProblems.find((x) => x.slug === p.line.slug && x.sku === p.line.sku);
            return (
              <li key={lineKey(p.line)} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                <div>
                  <p className="font-medium text-bark-900">{p.product?.name ?? p.line.slug}</p>
                  {p.ok && p.variantLabel && <p className="text-bark-600">{p.variantLabel}</p>}
                  {!p.ok && <p className="text-red-800">{UNAVAILABLE_TEXT[p.reason]} (در سفارش نمی‌آید)</p>}
                  {problem && <p className="text-red-800" role="alert">{LINE_REASON_TEXT[problem.reason]}{problem.available !== undefined ? ` (حداکثر ${formatNumber(problem.available)} عدد)` : ""}</p>}
                </div>
                {p.ok && <p className="text-bark-800">{formatNumber(p.quantity)} × {formatToman(p.unitPriceToman)}</p>}
              </li>
            );
          })}
        </ul>
        <p className="mt-4 flex items-baseline justify-between gap-3 border-t border-sand-200 pt-4">
          <span className="text-bark-700">جمع کالاها</span>
          <strong className="text-xl text-bark-900" data-testid="checkout-total">{formatToman(total)}</strong>
        </p>
        <p className="mt-2 text-xs text-bark-600">هزینهٔ ارسال در این مبلغ لحاظ نشده است.</p>
      </section>

      {real && customer.state.status === "loading" && <p role="status" className="text-bark-600">در حال بررسی ورود…</p>}
      {real && customer.state.status === "unreachable" && (
        <div role="alert" className="rounded-2xl border border-sand-300 bg-ivory-50 p-5 text-bark-700">
          <p>در حال حاضر به سامانهٔ ثبت سفارش دسترسی نداریم. سفارشی ثبت نمی‌شود؛ می‌توانید متن سفارش را بسازید و از راه اینستاگرام بفرستید.</p>
          <button type="button" onClick={customer.retry} className={`${secondary} mt-4`}>تلاش دوباره</button>
        </div>
      )}
      {real && customer.state.status === "signedOut" && <SignInPanel onSignedIn={customer.signedIn} onUnavailable={() => setSmsDown(true)} />}
      {real && smsDown && customer.state.status === "signedOut" && (
        <p role="note" className="rounded-2xl border border-sand-300 bg-ivory-50 p-4 text-sm leading-7 text-bark-700">ورود با پیامک در حال حاضر ممکن نیست، پس ثبت سفارش در سایت هم ممکن نیست. می‌توانید متن سفارش را بسازید و از راه اینستاگرام بفرستید.</p>
      )}
      {signedIn && customer.state.status === "signedIn" && (
        <p className="flex flex-wrap items-center justify-between gap-3 text-sm text-bark-700">
          <span>وارد شده‌اید با <span dir="ltr">{customer.state.customer.phone}</span></span>
          <button type="button" onClick={() => void customer.signOut()} className="min-h-11 px-2 underline">خروج</button>
        </p>
      )}

      {showForm && (
        <form onSubmit={placeOrder} noValidate className="space-y-5 rounded-2xl border border-sand-200 bg-ivory-50 p-5 sm:p-6" aria-labelledby="details-title" data-testid="shipping-form">
          <h2 id="details-title" className="text-lg font-bold text-bark-900">اطلاعات تماس و نشانی</h2>
          <Field label="نام و نام خانوادگی گیرنده" required error={errors.recipientName}>
            {(p) => <input {...p} type="text" autoComplete="name" {...fieldProps("recipientName")} />}
          </Field>
          <Field label="شمارهٔ موبایل گیرنده" required error={errors.recipientPhone}>
            {(p) => <input {...p} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="09123456789" {...fieldProps("recipientPhone")} className={`${p.className} text-start`} />}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="استان" required error={errors.province}>
              {(p) => (
                <select {...p} autoComplete="address-level1" {...fieldProps("province")}>
                  <option value="">انتخاب کنید</option>
                  {PROVINCES.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              )}
            </Field>
            <Field label="شهر" required error={errors.city}>
              {(p) => <input {...p} type="text" autoComplete="address-level2" {...fieldProps("city")} />}
            </Field>
          </div>
          <Field label="نشانی کامل" required error={errors.street} hint="خیابان، کوچه و نشانی دقیق">
            {(p) => <textarea {...p} rows={3} autoComplete="street-address" {...fieldProps("street")} />}
          </Field>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="پلاک" error={errors.plaque}>{(p) => <input {...p} type="text" inputMode="numeric" {...fieldProps("plaque")} />}</Field>
            <Field label="واحد" error={errors.unit}>{(p) => <input {...p} type="text" inputMode="numeric" {...fieldProps("unit")} />}</Field>
            <Field label="کد پستی" required error={errors.postalCode} hint="۱۰ رقم">
              {(p) => <input {...p} type="text" inputMode="numeric" autoComplete="postal-code" dir="ltr" {...fieldProps("postalCode")} className={`${p.className} text-start`} />}
            </Field>
          </div>
          <Field label="توضیحات سفارش (اختیاری)" error={errors.customerNote} hint="حداکثر ۳۰۰ نویسه">
            {(p) => <textarea {...p} rows={2} {...fieldProps("customerNote")} />}
          </Field>
          {canPlace && (
            <label className="flex items-start gap-3 text-sm leading-7 text-bark-800">
              <input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} className="mt-1.5 h-5 w-5 accent-bark-700" />
              <span>این نشانی در حساب من ذخیره شود.</span>
            </label>
          )}

          {failure && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm leading-7 text-red-900" data-testid="checkout-failure">{failure}</p>}

          <div className="flex flex-wrap items-center gap-3">
            {canPlace && <button type="submit" className={primary} disabled={busy} data-testid="place-order">{busy ? "در حال ثبت…" : "ثبت سفارش (بدون پرداخت)"}</button>}
            <button type="button" className={canPlace ? secondary : primary} onClick={makeText} data-testid="make-text">ساخت متن سفارش برای اینستاگرام</button>
          </div>
          {!canPlace && <p className="text-xs leading-6 text-bark-600">با این دکمه فقط متن سفارش ساخته می‌شود؛ چیزی ثبت یا ارسال نمی‌شود.</p>}
        </form>
      )}

      {orderText && (
        <section aria-labelledby="text-title" className="space-y-4 rounded-2xl border-2 border-dashed border-olive-700 bg-ivory-50 p-5 sm:p-6" data-testid="order-text">
          <h2 id="text-title" className="text-lg font-bold text-bark-900">پیش‌نمایش سفارش (ثبت نشده)</h2>
          <p className="text-sm leading-7 text-bark-700"><strong>این یک سفارش ثبت‌شده نیست.</strong> متن زیر را کپی کنید و در پیام مستقیم اینستاگرام برای گالری بفرستید. سفارش وقتی معتبر است که گالری آن را تأیید کند. سبد شما دست‌نخورده می‌ماند.</p>
          <textarea readOnly rows={Math.min(14, orderText.split("\n").length + 1)} value={orderText} aria-label="متن سفارش" className="block w-full rounded-xl border border-sand-300 bg-white p-4 text-sm leading-7 text-bark-900" />
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => void copyText()} className={secondary}>{copied ? "کپی شد" : "کپی متن سفارش"}</button>
            <a href={site.instagramUrl} target="_blank" rel="noopener noreferrer" className={primary}>باز کردن اینستاگرام گالری</a>
          </div>
        </section>
      )}
    </>,
  );
}

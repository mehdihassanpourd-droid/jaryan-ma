"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Container } from "@/components/ui/Container";
import { formatOrderNumber } from "@/domain/customer/schema";
import { formatNumber, formatToman } from "@/lib/format";
import { LIVE_CATALOG_BASE } from "@/lib/live-config";
import { ORDER_STATUS_LABEL, OrderApiError, type ApiOrder } from "@/lib/order-api";
import { nextStatuses } from "@/domain/customer/order-status";
import { CARRIER_LABEL, SHIPPING_METHOD_LABEL } from "@/domain/shipping/methods";
import { etaText, feeText } from "@/lib/delivery-text";
import { NO_PAYMENT_NOTE } from "./CartView";
import { orderApi } from "./orderClient";
import { SignInPanel } from "./SignInPanel";
import { useCustomer } from "./useCustomer";

const secondary = "inline-flex min-h-12 items-center justify-center rounded-full border border-bark-500/40 px-7 py-3 text-base font-medium text-bark-700 hover:bg-sand-100";
const dateFormat = new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" });
const IMAGE_KEY = /^images\/[A-Za-z0-9-]{1,64}\/[A-Za-z0-9-]{1,64}\.(jpg|png|webp)$/;
const imageUrl = (key: string | null): string | null => (key && LIVE_CATALOG_BASE && IMAGE_KEY.test(key) ? `${LIVE_CATALOG_BASE}/${key}` : null);

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Container className="py-10 sm:py-14">
      <h1 className="text-2xl font-bold text-bark-900 sm:text-3xl">{title}</h1>
      <div className="mt-8 space-y-8">{children}</div>
    </Container>
  );
}

const Notice = ({ children, alert }: { children: React.ReactNode; alert?: boolean }) => (
  <p role={alert ? "alert" : "status"} className="rounded-2xl border border-sand-300 bg-ivory-50 p-6 text-bark-700">{children}</p>
);

/** Signed-out / loading / unreachable handling shared by the order pages. Returns the ready content or the right message. */
function useGate(title: string) {
  const customer = useCustomer();
  if (!orderApi) return { gate: <Shell title={title}><Notice>این فروشگاه هنوز به سامانهٔ ثبت سفارش متصل نیست؛ سفارشی در سایت ثبت نمی‌شود و سابقه‌ای وجود ندارد.</Notice></Shell>, customer, ready: false as const };
  if (customer.state.status === "loading") return { gate: <Shell title={title}><Notice>در حال بررسی ورود…</Notice></Shell>, customer, ready: false as const };
  if (customer.state.status === "unreachable") {
    return { gate: <Shell title={title}><Notice alert>در حال حاضر به سامانهٔ سفارش‌ها دسترسی نداریم. <button type="button" onClick={customer.retry} className="underline">تلاش دوباره</button></Notice></Shell>, customer, ready: false as const };
  }
  if (customer.state.status === "signedOut") return { gate: <Shell title={title}><SignInPanel onSignedIn={customer.signedIn} /></Shell>, customer, ready: false as const };
  return { gate: null, customer, ready: true as const };
}

const STATUS_NOTE: Partial<Record<ApiOrder["status"], string>> = {
  confirmed: "گالری این سفارش را تأیید کرد.",
};

/** What the customer should read about the delivery right now (nothing before the gallery has confirmed the order). */
function deliveryStatus(order: ApiOrder): string | null {
  const pickup = order.delivery.method === "pickup";
  switch (order.status) {
    case "preparing": return "سفارش شما در حال آماده‌سازی است.";
    case "shipped": return pickup ? "سفارش شما آمادهٔ تحویل حضوری است." : "سفارش شما تحویل حامل شد و در راه است.";
    case "delivered": return pickup ? "سفارش را تحویل گرفتید." : "سفارش به دست شما رسید.";
    default: return null;
  }
}

function TrackingBlock({ shipment }: { shipment: NonNullable<ApiOrder["shipment"]> }) {
  const carrier = shipment.carrier === "other" ? (shipment.carrierName ?? CARRIER_LABEL.other) : CARRIER_LABEL[shipment.carrier];
  return (
    <p className="mt-2" data-testid="tracking">
      حامل: <strong>{carrier}</strong>
      {shipment.trackingCode && (
        <>
          <br />
          کد رهگیری: <strong dir="ltr" className="select-all" data-testid="tracking-code">{shipment.trackingCode}</strong>
          {shipment.trackingUrl && (
            <>
              {" "}
              <a href={shipment.trackingUrl} target="_blank" rel="noopener noreferrer" className="underline">پیگیری مرسوله</a>
            </>
          )}
        </>
      )}
    </p>
  );
}

function OrderBody({ order, onCancel, cancelling, cancelError }: { order: ApiOrder; onCancel: () => void; cancelling: boolean; cancelError: string | null }) {
  const s = order.shipping;
  const [asking, setAsking] = useState(false);
  const refusal = order.history.findLast((h) => h.status === "rejected" || h.status === "cancelled");
  const canCancel = nextStatuses(order.status, "customer").includes("cancelled");
  return (
    <div className="space-y-6" data-testid="order-detail">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-sand-100 px-4 py-1.5 text-sm font-medium text-bark-800" data-testid="order-status">{ORDER_STATUS_LABEL[order.status]}</span>
        <span className="text-sm text-bark-600">{dateFormat.format(new Date(order.placedAt))}</span>
      </div>
      {order.status === "pending" && (
        <p role="note" className="rounded-2xl border border-sand-300 bg-ivory-50 p-4 text-sm leading-7 text-bark-700">این سفارش ثبت شده و در انتظار تأیید گالری است. {NO_PAYMENT_NOTE}</p>
      )}
      {STATUS_NOTE[order.status] && <p role="note" className="rounded-2xl border border-sand-300 bg-ivory-50 p-4 text-sm leading-7 text-bark-700">{STATUS_NOTE[order.status]}</p>}
      {(order.status === "rejected" || order.status === "cancelled") && (
        <p role="note" className="rounded-2xl border border-sand-300 bg-ivory-50 p-4 text-sm leading-7 text-bark-800" data-testid="refusal-note">
          {order.status === "rejected" ? "گالری این سفارش را نپذیرفت." : refusal?.by === "customer" ? "شما این سفارش را لغو کردید." : "این سفارش لغو شد."}
          {refusal?.reason && <> دلیل: {refusal.reason}</>} کالاهای این سفارش دیگر برای شما نگه داشته نمی‌شود و هیچ مبلغی دریافت نشده بود.
        </p>
      )}
      <ul className="divide-y divide-sand-200 rounded-2xl border border-sand-200 bg-ivory-50" aria-label="اقلام سفارش">
        {order.items.map((item, i) => {
          const img = imageUrl(item.imageKey);
          return (
            <li key={`${item.sku ?? item.title}-${i}`} className="flex gap-4 p-4">
              <div className="h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-sand-100 ring-1 ring-sand-200">
                {/* eslint-disable-next-line @next/next/no-img-element -- static export: no image optimiser */}
                {img && <img src={img} alt={item.title} className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold text-bark-900">{item.title}</p>
                {item.variant && <p className="text-bark-600">{Object.values(item.variant).join("، ")}</p>}
                <p className="mt-1 text-bark-800">{formatNumber(item.quantity)} × {formatToman(item.unitPriceToman)}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <dl className="space-y-2 rounded-2xl border border-sand-200 bg-ivory-50 p-5 text-sm" data-testid="order-amounts">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-bark-700">جمع کالاها</dt>
          <dd className="text-bark-900" data-testid="order-subtotal">{formatToman(order.subtotalToman)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-bark-700">هزینهٔ ارسال{order.delivery.method ? ` (${SHIPPING_METHOD_LABEL[order.delivery.method]})` : ""}</dt>
          <dd className="text-bark-900" data-testid="order-shipping-fee">
            {order.delivery.method === null ? "ثبت نشده" : order.delivery.method === "pickup" ? "بدون هزینه" : feeText(order.shippingFeeToman)}
            {order.delivery.free && <span className="ms-2 text-olive-800">(ارسال رایگان)</span>}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-sand-200 pt-3">
          <dt className="font-medium text-bark-900">جمع کل سفارش</dt>
          <dd><strong className="text-xl text-bark-900" data-testid="order-total">{formatToman(order.totalToman)}</strong></dd>
        </div>
      </dl>
      <section aria-labelledby="ship-title" className="rounded-2xl border border-sand-200 bg-ivory-50 p-5 text-sm leading-8 text-bark-800" data-testid="delivery-details">
        <h2 id="ship-title" className="mb-2 text-base font-bold text-bark-900">{order.delivery.method === "pickup" ? "تحویل حضوری" : "نشانی تحویل"}</h2>
        {order.delivery.method && <p data-testid="delivery-method">روش ارسال: <strong>{SHIPPING_METHOD_LABEL[order.delivery.method]}</strong>{etaText(order.delivery.etaMinDays, order.delivery.etaMaxDays) && <span className="text-bark-600"> · {etaText(order.delivery.etaMinDays, order.delivery.etaMaxDays)}</span>}</p>}
        {order.delivery.note && <p className="text-bark-700">{order.delivery.note}</p>}
        <p>{s.recipientName}</p>
        {s.recipientPhone && <p dir="ltr" className="text-start">{s.recipientPhone}</p>}
        {order.delivery.method !== "pickup" && (
          <>
            <p>{[s.province, s.city, s.street, s.plaque ? `پلاک ${s.plaque}` : null, s.unit ? `واحد ${s.unit}` : null].filter(Boolean).join("، ")}</p>
            {s.postalCode && <p>کد پستی: <span dir="ltr">{s.postalCode}</span></p>}
          </>
        )}
        {order.customerNote && <p className="mt-2 text-bark-700">توضیحات: {order.customerNote}</p>}
        {deliveryStatus(order) && (
          <div className="mt-3 border-t border-sand-200 pt-3" data-testid="delivery-status">
            <p className="font-medium text-bark-900">{deliveryStatus(order)}</p>
            {order.shipment && <TrackingBlock shipment={order.shipment} />}
          </div>
        )}
      </section>
      <section aria-labelledby="history-title" className="rounded-2xl border border-sand-200 bg-ivory-50 p-5 text-sm leading-8 text-bark-800">
        <h2 id="history-title" className="mb-2 text-base font-bold text-bark-900">روند سفارش</h2>
        <ol className="space-y-2" data-testid="order-history">
          {order.history.map((h, i) => (
            <li key={i}>
              <strong>{i === 0 ? "سفارش ثبت شد" : ORDER_STATUS_LABEL[h.status]}</strong>
              <span className="text-bark-600"> · {dateFormat.format(new Date(h.at))}</span>
              {h.reason && <p className="text-bark-700">دلیل: {h.reason}</p>}
            </li>
          ))}
        </ol>
      </section>
      {canCancel && (
        <section aria-label="لغو سفارش" className="rounded-2xl border border-sand-200 bg-ivory-50 p-5">
          {!asking ? (
            <button type="button" onClick={() => setAsking(true)} className="inline-flex min-h-12 items-center rounded-full border border-red-800/40 px-6 text-sm font-medium text-red-900 hover:bg-red-50" data-testid="cancel-order">لغو سفارش</button>
          ) : (
            <div className="space-y-3" role="group" aria-label="تأیید لغو سفارش">
              <p className="text-sm leading-7 text-bark-800">سفارش لغو شود؟ کالاها دوباره برای دیگران آزاد می‌شود و این کار قابل بازگشت نیست.</p>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={onCancel} disabled={cancelling} className="inline-flex min-h-12 items-center rounded-full bg-red-800 px-6 text-sm font-medium text-white hover:bg-red-900 disabled:opacity-60" data-testid="confirm-cancel">{cancelling ? "در حال لغو…" : "بله، لغو شود"}</button>
                <button type="button" onClick={() => setAsking(false)} disabled={cancelling} className="inline-flex min-h-12 items-center rounded-full border border-bark-500/40 px-6 text-sm font-medium text-bark-700 hover:bg-sand-100">انصراف</button>
              </div>
            </div>
          )}
          {cancelError && <p role="alert" className="mt-3 text-sm text-red-800">{cancelError}</p>}
        </section>
      )}
    </div>
  );
}

/** One order (also the confirmation page after checkout): `/order?number=<n>`. Only the signed-in owner can read it. */
export function OrderPageView() {
  const raw = useSearchParams().get("number") ?? "";
  const number = /^\d{1,10}$/.test(raw) ? Number(raw) : null;
  const { gate, ready } = useGate("سفارش");
  const [state, setState] = useState<{ key: string; value: { order: ApiOrder } | { error: "not_found" | "failed" } } | null>(null);
  const [tick, setTick] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const key = `order:${number}`;

  useEffect(() => {
    if (!ready || !orderApi || number === null) return;
    let live = true;
    orderApi.getOrder(number).then(
      (order) => live && setState({ key, value: { order } }),
      (error: unknown) => live && setState({ key, value: { error: error instanceof OrderApiError && error.status === 404 ? "not_found" : "failed" } }),
    );
    return () => {
      live = false;
    };
  }, [ready, number, key, tick]);

  // A status change made by the gallery shows up without reloading: re-read when the person returns to the tab and every minute while it is visible.
  useEffect(() => {
    if (!ready) return;
    const refresh = () => document.visibilityState === "visible" && setTick((t) => t + 1);
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [ready]);

  async function cancelOrder() {
    if (!orderApi || number === null) return;
    setCancelling(true);
    setCancelError(null);
    try {
      setState({ key, value: { order: await orderApi.cancelOrder(number) } });
    } catch (error) {
      setCancelError(error instanceof OrderApiError && (error.code === "invalid_transition" || error.code === "order_changed") ? "این سفارش دیگر قابل لغو نیست؛ وضعیت تازه‌سازی شد." : "لغو انجام نشد. دوباره تلاش کنید.");
      setTick((t) => t + 1);
    } finally {
      setCancelling(false);
    }
  }

  if (gate) return gate;
  if (number === null) return <Shell title="سفارش"><Notice>شمارهٔ سفارش معتبر نیست.</Notice></Shell>;
  const current = state && state.key === key ? state.value : null;
  if (!current) return <Shell title={formatOrderNumber(number)}><Notice>در حال دریافت سفارش…</Notice></Shell>;
  if ("error" in current) return <Shell title="سفارش"><Notice alert>{current.error === "not_found" ? "این سفارش پیدا نشد." : "دریافت سفارش ممکن نشد. دوباره تلاش کنید."}</Notice></Shell>;
  return (
    <Shell title={`سفارش ${formatOrderNumber(current.order.number)}`}>
      <OrderBody order={current.order} onCancel={() => void cancelOrder()} cancelling={cancelling} cancelError={cancelError} />
      <p><Link href="/orders" className={secondary}>سابقهٔ سفارش‌ها</Link></p>
    </Shell>
  );
}

/** The signed-in customer's own orders, newest first: `/orders`. */
export function OrdersPageView() {
  const { gate, customer, ready } = useGate("سفارش‌های من");
  const [state, setState] = useState<{ items: ApiOrder[]; total: number; page: number } | "failed" | null>(null);
  const [more, setMore] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!ready || !orderApi) return;
    let live = true;
    orderApi.listOrders(1).then(
      (r) => live && setState({ items: r.items, total: r.total, page: 1 }),
      () => live && setState("failed"),
    );
    return () => {
      live = false;
    };
  }, [ready, tick]);

  // Statuses change on the gallery's side: re-read when the person returns to the tab and every minute while it is visible.
  useEffect(() => {
    if (!ready) return;
    const refresh = () => document.visibilityState === "visible" && setTick((t) => t + 1);
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [ready]);

  if (gate) return gate;
  if (state === null) return <Shell title="سفارش‌های من"><Notice>در حال دریافت سفارش‌ها…</Notice></Shell>;
  if (state === "failed") return <Shell title="سفارش‌های من"><Notice alert>دریافت سفارش‌ها ممکن نشد. دوباره تلاش کنید.</Notice></Shell>;

  async function loadMore() {
    if (!orderApi || state === null || state === "failed") return;
    setMore(true);
    try {
      const next = state.page + 1;
      const r = await orderApi.listOrders(next);
      setState({ items: [...state.items, ...r.items], total: r.total, page: next });
    } catch {
      /* the button stays; the person can retry */
    } finally {
      setMore(false);
    }
  }

  return (
    <Shell title="سفارش‌های من">
      {customer.state.status === "signedIn" && (
        <p className="flex flex-wrap items-center justify-between gap-3 text-sm text-bark-700">
          <span>وارد شده‌اید با <span dir="ltr">{customer.state.customer.phone}</span></span>
          <button type="button" onClick={() => void customer.signOut()} className="min-h-11 px-2 underline">خروج</button>
        </p>
      )}
      {state.items.length === 0 ? (
        <Notice>هنوز سفارشی ثبت نکرده‌اید.</Notice>
      ) : (
        <>
          <ul className="space-y-3" aria-label="فهرست سفارش‌ها" data-testid="orders-list">
            {state.items.map((o) => (
              <li key={o.number}>
                <Link href={`/order?number=${o.number}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sand-200 bg-ivory-50 p-4 hover:bg-sand-100">
                  <span>
                    <strong className="block text-bark-900">{formatOrderNumber(o.number)}</strong>
                    <span className="text-xs text-bark-600">{dateFormat.format(new Date(o.placedAt))} · {formatNumber(o.items.reduce((n, i) => n + i.quantity, 0))} کالا</span>
                  </span>
                  <span className="text-end">
                    <span className="block text-sm font-medium text-bark-800">{ORDER_STATUS_LABEL[o.status]}</span>
                    <span className="text-sm text-bark-700">{formatToman(o.totalToman)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {state.items.length < state.total && <button type="button" onClick={() => void loadMore()} disabled={more} className={secondary}>{more ? "در حال دریافت…" : "سفارش‌های قدیمی‌تر"}</button>}
        </>
      )}
    </Shell>
  );
}

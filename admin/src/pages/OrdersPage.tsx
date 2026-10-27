import { useEffect, useState } from "react";
import { formatToman } from "@/lib/format";
import { formatOrderNumber } from "@/domain/customer/schema";
import { api } from "../api/client";
import { apiErrorMessage } from "../lib/errors";
import { hrefFor, navigate, useRoute } from "../router";
import { SelectField } from "../ui/controls";
import { Alert, Badge, EmptyState, Loading, Pagination } from "../ui/feedback";
import { Button } from "../ui/controls";
import type { AdminOrderJson as Order } from "@/domain/customer/order-admin";

const PAGE_SIZE = 20;
const STATUS_LABEL: Record<Order["status"], string> = { pending: "در انتظار تأیید", confirmed: "تأیید شده", preparing: "در حال آماده‌سازی", shipped: "ارسال شده", delivered: "تحویل داده شده", cancelled: "لغو شده" };
const TONE: Record<Order["status"], "neutral" | "olive" | "warn" | "muted"> = { pending: "warn", confirmed: "olive", preparing: "olive", shipped: "olive", delivered: "neutral", cancelled: "muted" };
const dateFormat = new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" });

export function OrdersPage({ number }: { number: number | null }) {
  return number === null ? <OrderList /> : <OrderDetail number={number} />;
}

function OrderList() {
  const route = useRoute();
  const status = route.params.get("status") ?? "";
  const page = Math.max(1, Number(route.params.get("page") ?? 1) || 1);
  const [state, setState] = useState<{ key: string; value: { items: Order[]; total: number } | { error: string } } | null>(null);
  const [tick, setTick] = useState(0);
  const key = `${status}|${page}|${tick}`;

  useEffect(() => {
    let live = true;
    const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), ...(status ? { status } : {}) });
    api<{ items: Order[]; total: number }>("GET", `/orders?${query}`).then(
      (value) => live && setState({ key, value }),
      (e: unknown) => live && setState({ key, value: { error: apiErrorMessage(e) } }),
    );
    return () => {
      live = false;
    };
  }, [key, page, status]);

  const current = state && state.key === key ? state.value : null;
  return (
    <div className="stack">
      <div className="page-head"><h1>سفارش‌ها</h1></div>
      <Alert>این بخش فقط نمایشی است: تأیید، لغو یا تغییر وضعیت سفارش هنوز در پنل نیست. پرداخت آنلاین هم فعال نیست.</Alert>
      <form className="filters card" aria-label="فیلتر سفارش‌ها" onSubmit={(e) => e.preventDefault()}>
        <SelectField label="وضعیت" value={status} onChange={(e) => navigate("/orders", { status: e.target.value })} options={[{ value: "", label: "همه" }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))]} />
      </form>
      {!current ? (
        <Loading />
      ) : "error" in current ? (
        <Alert tone="error" action={<Button onClick={() => setTick((t) => t + 1)}>تلاش دوباره</Button>}>{current.error}</Alert>
      ) : current.items.length === 0 ? (
        <EmptyState title={status ? "سفارشی با این وضعیت نیست" : "هنوز سفارشی ثبت نشده است"}>سفارش‌هایی که مشتریان از فروشگاه ثبت می‌کنند اینجا دیده می‌شود.</EmptyState>
      ) : (
        <>
          <p className="muted" aria-live="polite">{current.total.toLocaleString("fa-IR")} سفارش</p>
          <ul className="product-list" aria-label="فهرست سفارش‌ها">
            {current.items.map((o) => (
              <li key={o.number} className="product-row">
                <div className="stack">
                  <h3><a href={hrefFor(`/orders/${o.number}`)}>{formatOrderNumber(o.number)}</a></h3>
                  <div className="product-meta">
                    <Badge tone={TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
                    <span>{dateFormat.format(new Date(o.placedAt))}</span>
                  </div>
                  <div className="product-meta">
                    <span>{o.shipping.recipientName ?? o.customer.name ?? "—"}</span>
                    <span>{o.shipping.city}</span>
                    <span>{formatToman(o.totalToman)}</span>
                    <span>{o.items.reduce((n, i) => n + i.quantity, 0).toLocaleString("fa-IR")} کالا</span>
                  </div>
                </div>
                <div className="product-actions"><a className="btn btn-secondary btn-small" href={hrefFor(`/orders/${o.number}`)}>مشاهده</a></div>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={current.total} onPage={(n) => navigate("/orders", { status, page: String(n) })} />
        </>
      )}
    </div>
  );
}

function OrderDetail({ number }: { number: number }) {
  const [state, setState] = useState<{ number: number; value: { order: Order } | { error: string } } | null>(null);
  useEffect(() => {
    let live = true;
    api<{ order: Order }>("GET", `/orders/${number}`).then(
      (value) => live && setState({ number, value }),
      (e: unknown) => live && setState({ number, value: { error: apiErrorMessage(e) } }),
    );
    return () => {
      live = false;
    };
  }, [number]);

  const current = state && state.number === number ? state.value : null;
  if (!current) return <Loading />;
  if ("error" in current) return <Alert tone="error">{current.error} <a href={hrefFor("/orders")}>بازگشت به فهرست</a></Alert>;
  const o = current.order;
  const s = o.shipping;
  return (
    <div className="stack">
      <div className="page-head">
        <h1>سفارش {formatOrderNumber(o.number)}</h1>
        <a className="btn btn-ghost btn-small" href={hrefFor("/orders")}>بازگشت به فهرست</a>
      </div>
      <div className="row">
        <Badge tone={TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
        <span className="muted">{dateFormat.format(new Date(o.placedAt))}</span>
      </div>
      <section className="card stack" aria-labelledby="o-items">
        <h2 id="o-items">اقلام</h2>
        <ul className="product-list">
          {o.items.map((i, k) => (
            <li key={`${i.sku ?? i.title}-${k}`} className="product-row">
              <div className="stack">
                <h3>{i.title}</h3>
                <div className="product-meta">
                  {i.variant && <span>{Object.values(i.variant).join("، ")}</span>}
                  {i.sku && <span dir="ltr">{i.sku}</span>}
                  <span>{i.quantity.toLocaleString("fa-IR")} × {formatToman(i.unitPriceToman)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p><strong>جمع کالاها: {formatToman(o.totalToman)}</strong> <span className="muted">(هزینهٔ ارسال لحاظ نشده)</span></p>
      </section>
      <section className="card stack" aria-labelledby="o-ship">
        <h2 id="o-ship">گیرنده و نشانی</h2>
        <p>{s.recipientName}{s.recipientPhone && <> · <span dir="ltr">{s.recipientPhone}</span></>}</p>
        <p>{[s.province, s.city, s.street, s.plaque ? `پلاک ${s.plaque}` : null, s.unit ? `واحد ${s.unit}` : null].filter(Boolean).join("، ")}</p>
        {s.postalCode && <p>کد پستی: <span dir="ltr">{s.postalCode}</span></p>}
        {o.customerNote && <p>توضیحات مشتری: {o.customerNote}</p>}
      </section>
      <section className="card stack" aria-labelledby="o-customer">
        <h2 id="o-customer">مشتری</h2>
        {o.customer.phone ? <p>{o.customer.name ?? "—"} · <span dir="ltr">{o.customer.phone}</span></p> : <p className="muted">حساب این مشتری حذف شده است.</p>}
      </section>
    </div>
  );
}

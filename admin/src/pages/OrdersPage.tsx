import { useEffect, useState } from "react";
import { formatToman } from "@/lib/format";
import type { AdminOrderJson as Order } from "@/domain/customer/order-admin";
import { needsReason, nextStatuses, ORDER_ACTION_LABEL, ORDER_REASON_MAX, ORDER_STATUS_LABEL, ORDER_STATUSES, type OrderStatusValue } from "@/domain/customer/order-status";
import { formatOrderNumber } from "@/domain/customer/schema";
import { CARRIERS, CARRIER_LABEL, CARRIER_NAME_MAX, SHIPPING_METHOD_LABEL, TRACKING_CODE_MAX, type CarrierKey } from "@/domain/shipping/methods";
import { ApiError, api } from "../api/client";
import { apiErrorMessage } from "../lib/errors";
import { hrefFor, navigate, useRoute } from "../router";
import { useSession } from "../session";
import { Button, SelectField, TextAreaField, TextField } from "../ui/controls";
import { Alert, Badge, EmptyState, Loading, Pagination, useToast } from "../ui/feedback";

const PAGE_SIZE = 20;
const TONE: Record<OrderStatusValue, "neutral" | "olive" | "warn" | "muted"> = { pending: "warn", confirmed: "olive", preparing: "olive", shipped: "olive", delivered: "neutral", cancelled: "muted", rejected: "muted" };
const dateFormat = new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" });
const ACTOR_LABEL = { customer: "مشتری", system: "سیستم" } as const;

export function OrdersPage({ number, onChanged }: { number: number | null; onChanged: () => void }) {
  return number === null ? <OrderList /> : <OrderDetail number={number} onChanged={onChanged} />;
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
  const waiting = current && !("error" in current) ? current.items.filter((o) => o.status === "pending").length : 0;
  return (
    <div className="stack">
      <div className="page-head"><h1>سفارش‌ها</h1></div>
      {waiting > 0 && !status && (
        <div className="attention-banner" role="status" data-testid="pending-heading">
          {waiting.toLocaleString("fa-IR")} سفارش در انتظار تصمیم شماست؛ بالای فهرست هستند. تا تأیید یا رد نشوند، موجودی‌شان برای دیگران رزرو است.
        </div>
      )}
      <form className="filters card" aria-label="فیلتر سفارش‌ها" onSubmit={(e) => e.preventDefault()}>
        <SelectField label="وضعیت" value={status} onChange={(e) => navigate("/orders", { status: e.target.value })} options={[{ value: "", label: "همه (سفارش‌های باز اول)" }, ...ORDER_STATUSES.map((value) => ({ value, label: ORDER_STATUS_LABEL[value] }))]} />
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
              <li key={o.number} className={`product-row${o.status === "pending" ? " row-attention" : ""}`} data-status={o.status}>
                <div className="stack">
                  <h3><a href={hrefFor(`/orders/${o.number}`)}>{formatOrderNumber(o.number)}</a></h3>
                  <div className="product-meta">
                    <Badge tone={TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                    <span>{dateFormat.format(new Date(o.placedAt))}</span>
                  </div>
                  <div className="product-meta">
                    <span>{o.shipping.recipientName ?? o.customer.name ?? "—"}</span>
                    <span>{o.shipping.city || "—"}</span>
                    <span>{o.delivery.method ? SHIPPING_METHOD_LABEL[o.delivery.method] : "روش ارسال ثبت نشده"}</span>
                    <span>{formatToman(o.totalToman)}</span>
                    <span>{o.items.reduce((n, i) => n + i.quantity, 0).toLocaleString("fa-IR")} کالا</span>
                  </div>
                </div>
                <div className="product-actions"><a className={`btn btn-small ${o.status === "pending" ? "btn-primary" : "btn-secondary"}`} href={hrefFor(`/orders/${o.number}`)}>{o.status === "pending" ? "بررسی" : "مشاهده"}</a></div>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={current.total} onPage={(n) => navigate("/orders", { status, page: String(n) })} />
        </>
      )}
    </div>
  );
}

function OrderDetail({ number, onChanged }: { number: number; onChanged: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const [state, setState] = useState<{ number: number; tick: number; value: { order: Order } | { error: string } } | null>(null);
  const [tick, setTick] = useState(0);
  const [asking, setAsking] = useState<OrderStatusValue | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [shipForm, setShipForm] = useState<ShipForm | null>(null);

  useEffect(() => {
    let live = true;
    api<{ order: Order }>("GET", `/orders/${number}`).then(
      (value) => live && setState({ number, tick, value }),
      (e: unknown) => live && setState({ number, tick, value: { error: apiErrorMessage(e) } }),
    );
    return () => {
      live = false;
    };
  }, [number, tick]);

  const current = state && state.number === number && state.tick === tick ? state.value : null;
  if (!current) return <Loading />;
  if ("error" in current) return <Alert tone="error">{current.error} <a href={hrefFor("/orders")}>بازگشت به فهرست</a></Alert>;
  const o = current.order;
  const s = o.shipping;
  const actions = can("order:manage") ? nextStatuses(o.status, "staff") : [];
  const held = o.items.reduce((n, i) => n + i.reservedQuantity, 0);

  async function move(to: OrderStatusValue, why: string, shipment?: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await api<{ order: Order }>("POST", `/orders/${number}/transition`, { body: { to, expectedStatus: o.status, reason: why.trim(), ...(shipment ? { shipment } : {}) } });
      setState({ number, tick, value: { order: r.order } });
      setAsking(null);
      setShipForm(null);
      setReason("");
      toast.success(`وضعیت سفارش: ${ORDER_STATUS_LABEL[to]}`);
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && (e.code === "order_changed" || e.code === "invalid_transition")) {
        toast.error("این سفارش در همین فاصله تغییر کرده است؛ آخرین وضعیت بارگذاری شد.");
        setAsking(null);
        setTick((t) => t + 1);
        onChanged();
      } else toast.error(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <h1>سفارش {formatOrderNumber(o.number)}</h1>
        <a className="btn btn-ghost btn-small" href={hrefFor("/orders")}>بازگشت به فهرست</a>
      </div>
      <div className="row">
        <Badge tone={TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
        <span className="muted">{dateFormat.format(new Date(o.placedAt))}</span>
      </div>

      {o.status === "pending" && (
        <div className="attention-banner" role="status" data-testid="pending-notice">
          این سفارش منتظر تصمیم شماست. موجودی کالاهایش همین حالا برای او رزرو شده است؛ با رد یا لغو، موجودی خودکار برمی‌گردد. پرداختی دریافت نشده است.
        </div>
      )}
      {actions.length > 0 && (
        <section className="card stack" aria-labelledby="o-actions" data-testid="order-actions">
          <h2 id="o-actions">اقدام</h2>
          <div className="row">
            {actions.map((to) => (
              <Button key={to} variant={to === "confirmed" || to === "preparing" || to === "shipped" || to === "delivered" ? "primary" : "danger"} disabled={busy} loading={busy && asking === null} onClick={() => (to === "shipped" ? (setAsking(to), setShipForm(shipFormFor(o))) : needsReason(to) ? (setAsking(to), setReason("")) : void move(to, ""))}>
                {ORDER_ACTION_LABEL[to]}
              </Button>
            ))}
          </div>
          {asking === "shipped" && shipForm && (
            <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); const built = shipmentBody(shipForm); if (built) void move("shipped", "", built); else toast.error("برای «سایر» نام حامل را بنویسید."); }} aria-label="ثبت ارسال" data-testid="ship-form">
              <ShipmentFields form={shipForm} onChange={setShipForm} pickup={o.delivery.method === "pickup"} />
              <p className="hint">حامل و کد رهگیری اختیاری است و بعداً هم می‌شود آن را اضافه یا اصلاح کرد.</p>
              <div className="row">
                <Button type="submit" variant="primary" loading={busy}>{o.delivery.method === "pickup" ? "آمادهٔ تحویل حضوری است" : "ثبت ارسال"}</Button>
                <Button onClick={() => { setAsking(null); setShipForm(null); }} disabled={busy}>انصراف</Button>
              </div>
            </form>
          )}
          {asking && asking !== "shipped" && (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); void move(asking, reason); }} aria-label={ORDER_ACTION_LABEL[asking]} data-testid="reason-form">
              <TextAreaField label="دلیل (برای مشتری نمایش داده می‌شود؛ اختیاری)" rows={3} value={reason} counter={{ value: reason.length, max: ORDER_REASON_MAX }} onChange={(e) => setReason(e.target.value)} hint="اطلاعات شخصی ننویسید." />
              <div className="row">
                <Button type="submit" variant="danger" loading={busy}>{ORDER_ACTION_LABEL[asking]}</Button>
                <Button onClick={() => setAsking(null)} disabled={busy}>انصراف</Button>
              </div>
            </form>
          )}
        </section>
      )}

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
                  {i.reservedQuantity > 0 && <Badge tone="warn">{i.reservedQuantity.toLocaleString("fa-IR")} عدد رزرو شده</Badge>}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <dl className="amounts" data-testid="order-amounts">
          <div><dt>جمع کالاها</dt><dd data-testid="order-subtotal">{formatToman(o.subtotalToman)}</dd></div>
          <div>
            <dt>هزینهٔ ارسال{o.delivery.method ? ` (${SHIPPING_METHOD_LABEL[o.delivery.method]})` : ""}</dt>
            <dd data-testid="order-shipping-fee">{o.delivery.method === null ? "ثبت نشده (سفارش قدیمی)" : o.delivery.method === "pickup" ? "بدون هزینه" : o.shippingFeeToman === 0 ? "رایگان" : formatToman(o.shippingFeeToman)}{o.delivery.free && <> <Badge tone="olive">ارسال رایگان</Badge></>}</dd>
          </div>
          <div className="amounts-total"><dt>جمع کل</dt><dd><strong data-testid="order-total">{formatToman(o.totalToman)}</strong></dd></div>
        </dl>
        {(o.status === "cancelled" || o.status === "rejected") && <p className="muted">موجودی این سفارش به انبار برگردانده شد.</p>}
        {held === 0 && o.status !== "cancelled" && o.status !== "rejected" && <p className="muted">این سفارش موجودی رزرو‌شده‌ای ندارد (ساخت پس از سفارش، یا پیش از ساخت سامانهٔ رزرو ثبت شده).</p>}
      </section>

      <section className="card stack" aria-labelledby="o-ship">
        <h2 id="o-ship">{o.delivery.method === "pickup" ? "تحویل حضوری" : "گیرنده و نشانی"}</h2>
        {o.delivery.method && <p data-testid="delivery-method">روش ارسال: <strong>{SHIPPING_METHOD_LABEL[o.delivery.method]}</strong>{o.delivery.weightGrams !== null && <span className="muted"> · وزن محاسبه‌شده {o.delivery.weightGrams.toLocaleString("fa-IR")} گرم</span>}</p>}
        <p>{s.recipientName}{s.recipientPhone && <> · <span dir="ltr">{s.recipientPhone}</span></>}</p>
        {o.delivery.method !== "pickup" && (
          <>
            <p>{[s.province, s.city, s.street, s.plaque ? `پلاک ${s.plaque}` : null, s.unit ? `واحد ${s.unit}` : null].filter(Boolean).join("، ")}</p>
            {s.postalCode && <p>کد پستی: <span dir="ltr">{s.postalCode}</span></p>}
          </>
        )}
        {o.customerNote && <p>توضیحات مشتری: {o.customerNote}</p>}
      </section>

      {["confirmed", "preparing", "shipped", "delivered"].includes(o.status) && (
        <section className="card stack" aria-labelledby="o-carrier" data-testid="shipment-section">
          <h2 id="o-carrier">حامل و کد رهگیری</h2>
          {o.shipment ? (
            <p data-testid="shipment-current">
              {o.shipment.carrier === "other" ? (o.shipment.carrierName ?? CARRIER_LABEL.other) : CARRIER_LABEL[o.shipment.carrier]}
              {o.shipment.trackingCode && <> · کد رهگیری: <strong dir="ltr" data-testid="shipment-code">{o.shipment.trackingCode}</strong></>}
              <span className="muted"> · مشتری این را در صفحهٔ سفارش خودش می‌بیند</span>
            </p>
          ) : (
            <p className="muted">هنوز حامل یا کد رهگیری ثبت نشده است.</p>
          )}
          {can("order:manage") && (
            <ShipmentEditor
              key={o.shipment?.updatedAt ?? "none"}
              initial={shipFormFor(o)}
              pickup={o.delivery.method === "pickup"}
              onSaved={(order) => { setState({ number, tick, value: { order } }); toast.success("حامل و کد رهگیری ذخیره شد."); }}
              number={number}
              hasShipment={o.shipment !== null}
            />
          )}
        </section>
      )}

      <section className="card stack" aria-labelledby="o-customer">
        <h2 id="o-customer">مشتری</h2>
        {o.customer.phone ? <p>{o.customer.name ?? "—"} · <span dir="ltr">{o.customer.phone}</span></p> : <p className="muted">حساب این مشتری حذف شده است.</p>}
      </section>

      <section className="card stack" aria-labelledby="o-history">
        <h2 id="o-history">تاریخچهٔ وضعیت</h2>
        <ol className="timeline" aria-label="تاریخچهٔ وضعیت" data-testid="history">
          {o.history.map((h, i) => (
            <li key={i}>
              <strong>{h.from === null ? "ثبت سفارش" : ORDER_STATUS_LABEL[h.to]}</strong>
              <span className="muted"> · {dateFormat.format(new Date(h.at))} · {h.actor === "staff" ? (h.actorLabel ?? "کارمند") : ACTOR_LABEL[h.actor]}</span>
              {h.reason && <p>دلیل: {h.reason}</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

interface ShipForm {
  carrier: CarrierKey;
  carrierName: string;
  trackingCode: string;
}

/** Starts from what is saved, else from the delivery method the customer chose. */
function shipFormFor(o: Order): ShipForm {
  return o.shipment
    ? { carrier: o.shipment.carrier, carrierName: o.shipment.carrierName ?? "", trackingCode: o.shipment.trackingCode ?? "" }
    : { carrier: o.delivery.method ?? "post", carrierName: "", trackingCode: "" };
}

/** The request body, or null when it is incomplete ("other" needs a name). */
function shipmentBody(form: ShipForm): Record<string, unknown> | null {
  if (form.carrier === "other" && !form.carrierName.trim()) return null;
  return { carrier: form.carrier, carrierName: form.carrier === "other" ? form.carrierName.trim() : null, trackingCode: form.trackingCode.trim() };
}

function ShipmentFields({ form, onChange, pickup }: { form: ShipForm; onChange: (next: ShipForm) => void; pickup: boolean }) {
  return (
    <>
      <SelectField label="حامل" value={form.carrier} onChange={(e) => onChange({ ...form, carrier: e.target.value as CarrierKey })} options={CARRIERS.map((c) => ({ value: c, label: CARRIER_LABEL[c] }))} />
      {form.carrier === "other" && <TextField label="نام حامل" required value={form.carrierName} maxLength={CARRIER_NAME_MAX} onChange={(e) => onChange({ ...form, carrierName: e.target.value })} />}
      {!pickup && (
        <TextField label="کد رهگیری (اختیاری)" hint="حروف، رقم و - _ . / فاصله؛ حداکثر ۶۴ نویسه." dir="ltr" className="ltr-input" value={form.trackingCode} maxLength={TRACKING_CODE_MAX} onChange={(e) => onChange({ ...form, trackingCode: e.target.value })} />
      )}
    </>
  );
}

/** Enter or correct the carrier and tracking code of an order that is already confirmed. */
function ShipmentEditor({ initial, pickup, number, hasShipment, onSaved }: { initial: ShipForm; pickup: boolean; number: number; hasShipment: boolean; onSaved: (order: Order) => void }) {
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const body = shipmentBody(form);
    if (!body) return toast.error("برای «سایر» نام حامل را بنویسید.");
    setBusy(true);
    try {
      onSaved((await api<{ order: Order }>("PUT", `/orders/${number}/shipment`, { body })).order);
    } catch (e) {
      toast.error(e instanceof ApiError && e.status === 422 ? "کد رهگیری یا نام حامل معتبر نیست؛ فقط حروف، رقم و - _ . / مجاز است." : apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" noValidate onSubmit={save} aria-label="ثبت حامل و کد رهگیری" data-testid="shipment-form">
      <ShipmentFields form={form} onChange={setForm} pickup={pickup} />
      <div><Button type="submit" loading={busy}>{hasShipment ? "اصلاح حامل و کد رهگیری" : "ذخیرهٔ حامل و کد رهگیری"}</Button></div>
    </form>
  );
}

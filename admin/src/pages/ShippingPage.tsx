import { useEffect, useState } from "react";
import { IRAN_PROVINCES } from "@/domain/customer/geo";
import { MAX_ETA_DAYS, MAX_WEIGHT_GRAMS, type ShippingConfigJson } from "@/domain/shipping/config";
import { SHIPPING_METHOD_LABEL, methodNeedsAddress, type ShippingMethodKey } from "@/domain/shipping/methods";
import { ApiError, api } from "../api/client";
import { apiErrorMessage } from "../lib/errors";
import { parsePrice, parseWhole, priceToInput } from "../lib/money";
import { useSession } from "../session";
import { Button, NumberField, SelectField, TextAreaField, TextField } from "../ui/controls";
import { Alert, Loading, useToast } from "../ui/feedback";

/** The shipping table as text fields: numbers are parsed exactly (BigInt rules) only when saving. */
interface RateDraft {
  key: string;
  provinces: string[];
  cities: string;
  minWeight: string;
  maxWeight: string;
  price: string;
}
interface MethodDraft {
  method: ShippingMethodKey;
  enabled: boolean;
  etaMin: string;
  etaMax: string;
  note: string;
  rates: RateDraft[];
}
interface Draft {
  version: number;
  defaultItemWeight: string;
  packagingWeight: string;
  freeEnabled: boolean;
  freeThreshold: string;
  freeMethods: ShippingMethodKey[];
  methods: MethodDraft[];
}

let counter = 0;
const newKey = () => `r${++counter}`;
const text = (n: number | null) => (n === null ? "" : String(n));

function toDraft(config: ShippingConfigJson): Draft {
  return {
    version: config.version,
    defaultItemWeight: String(config.defaultItemWeightGrams),
    packagingWeight: String(config.packagingWeightGrams),
    freeEnabled: config.freeShipping.enabled,
    freeThreshold: priceToInput(config.freeShipping.thresholdToman),
    freeMethods: config.freeShipping.methods,
    methods: config.methods.map((m) => ({
      method: m.method,
      enabled: m.enabled,
      etaMin: text(m.etaMinDays),
      etaMax: text(m.etaMaxDays),
      note: m.note ?? "",
      rates: m.rates.map((r) => ({
        key: newKey(),
        provinces: r.provinces,
        cities: r.cities.join("، "),
        minWeight: String(r.minWeightGrams),
        maxWeight: text(r.maxWeightGrams),
        price: priceToInput(r.priceToman),
      })),
    })),
  };
}

const splitCities = (value: string) => value.split(/[,،\n]/).map((c) => c.trim()).filter(Boolean);

type Errors = Record<string, string>;

/** Builds the request body, or the field errors in plain Persian. Paths: `m.<method>.<field>` and `m.<method>.rate.<key>.<field>`. */
function toBody(draft: Draft): { ok: true; body: Record<string, unknown> } | { ok: false; errors: Errors } {
  const errors: Errors = {};
  const whole = (path: string, value: string, max: number, required: boolean): number | null => {
    const parsed = parseWhole(value, max);
    if (!parsed.ok) {
      errors[path] = parsed.reason === "too_large" ? "عدد بیش از حد بزرگ است." : "فقط عدد صحیح بنویسید.";
      return null;
    }
    if (parsed.value === null && required) errors[path] = "این مقدار لازم است.";
    return parsed.value;
  };
  const price = (path: string, value: string, required: boolean): number | null => {
    const parsed = parsePrice(value);
    if (!parsed.ok) {
      errors[path] = parsed.reason === "too_large" ? "مبلغ بیش از حد بزرگ است." : "مبلغ را فقط با رقم بنویسید.";
      return null;
    }
    if (parsed.value === null && required) errors[path] = "قیمت را بنویسید (برای ارسال رایگان عدد ۰).";
    return parsed.value;
  };
  const defaultItemWeightGrams = whole("defaultItemWeight", draft.defaultItemWeight, 100_000, true);
  const packagingWeightGrams = whole("packagingWeight", draft.packagingWeight, 100_000, false) ?? 0;
  if (defaultItemWeightGrams !== null && defaultItemWeightGrams < 1) errors.defaultItemWeight = "وزن پیش‌فرض باید دست‌کم ۱ گرم باشد.";
  const methods = draft.methods.map((m) => {
    const at = (field: string) => `m.${m.method}.${field}`;
    const etaMinDays = whole(at("etaMin"), m.etaMin, MAX_ETA_DAYS, false);
    const etaMaxDays = whole(at("etaMax"), m.etaMax, MAX_ETA_DAYS, false);
    const carried = methodNeedsAddress(m.method);
    return {
      method: m.method,
      enabled: m.enabled,
      etaMinDays,
      etaMaxDays,
      note: m.note,
      rates: carried
        ? m.rates.map((r) => ({
            provinces: r.provinces,
            cities: splitCities(r.cities),
            minWeightGrams: whole(at(`rate.${r.key}.minWeight`), r.minWeight, MAX_WEIGHT_GRAMS, false) ?? 0,
            maxWeightGrams: whole(at(`rate.${r.key}.maxWeight`), r.maxWeight, MAX_WEIGHT_GRAMS, false),
            priceToman: price(at(`rate.${r.key}.price`), r.price, true) ?? 0,
          }))
        : [],
    };
  });
  const thresholdToman = price("freeThreshold", draft.freeThreshold, draft.freeEnabled);
  if (draft.freeEnabled && thresholdToman !== null && thresholdToman < 1) errors.freeThreshold = "حداقل مبلغ باید دست‌کم ۱ تومان باشد.";
  if (draft.freeEnabled && draft.freeMethods.length === 0) errors.freeMethods = "دست‌کم یک روش ارسال را انتخاب کنید.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body: { expectedVersion: draft.version, defaultItemWeightGrams, packagingWeightGrams, freeShipping: { enabled: draft.freeEnabled, thresholdToman, methods: draft.freeMethods }, methods } };
}

/** The server's rule codes, in words an owner understands. Keyed by the issue message. */
const RULE_TEXT: Record<string, string> = {
  enabled_needs_rate: "برای روشی که فعال است دست‌کم یک نرخ بنویسید، وگرنه به هیچ‌جا ارسال نمی‌شود.",
  overlapping_rates: "دو نرخ برای یک مقصد، وزن‌های هم‌پوشان دارند؛ بازه‌ها را جدا کنید.",
  weight_band: "حداکثر وزن نباید از حداقل وزن کمتر باشد.",
  cities_need_province: "برای نرخ شهری، استان را هم انتخاب کنید.",
  eta_range: "حداکثر روز نباید از حداقل روز کمتر باشد.",
  duplicate_province: "یک استان دوبار انتخاب شده است.",
  invalid_province: "نام استان معتبر نیست.",
  free_threshold_required: "برای فعال بودن ارسال رایگان، حداقل مبلغ سفارش را (دست‌کم ۱ تومان) بنویسید.",
  free_methods_required: "برای فعال بودن ارسال رایگان، دست‌کم یک روش ارسال را انتخاب کنید.",
  pickup_is_always_free: "تحویل حضوری همیشه رایگان است و نیازی به انتخاب ندارد.",
};

function serverErrors(error: ApiError): string[] {
  const out: string[] = [];
  for (const issue of error.issues) {
    const rule = RULE_TEXT[issue.code];
    if (rule && !out.includes(rule)) out.push(rule);
  }
  return out;
}

export function ShippingPage() {
  const { can } = useSession();
  const toast = useToast();
  const writable = can("shipping:manage");
  const [state, setState] = useState<{ draft: Draft; original: string } | { error: string } | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [serverNotes, setServerNotes] = useState<string[]>([]);
  const [stale, setStale] = useState<ShippingConfigJson | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    api<{ config: ShippingConfigJson }>("GET", "/shipping/config").then(
      ({ config }) => {
        if (!live) return;
        const draft = toDraft(config);
        setState({ draft, original: JSON.stringify(draft) });
      },
      (e: unknown) => live && setState({ error: apiErrorMessage(e) }),
    );
    return () => {
      live = false;
    };
  }, [tick]);

  if (!state) return <Loading />;
  if ("error" in state) return <Alert tone="error" action={<Button onClick={() => setTick((t) => t + 1)}>تلاش دوباره</Button>}>{state.error}</Alert>;
  const { draft } = state;
  const dirty = JSON.stringify(draft) !== state.original;

  const update = (next: Draft) => setState({ draft: next, original: state.original });
  const patchMethod = (method: ShippingMethodKey, patch: Partial<MethodDraft>) => update({ ...draft, methods: draft.methods.map((m) => (m.method === method ? { ...m, ...patch } : m)) });
  const patchRate = (method: ShippingMethodKey, key: string, patch: Partial<RateDraft>) =>
    update({ ...draft, methods: draft.methods.map((m) => (m.method === method ? { ...m, rates: m.rates.map((r) => (r.key === key ? { ...r, ...patch } : r)) } : m)) });
  const clearError = (path: string) => setErrors((current) => (path in current ? Object.fromEntries(Object.entries(current).filter(([k]) => k !== path)) : current));

  async function save() {
    const built = toBody(draft);
    setServerNotes([]);
    if (!built.ok) {
      setErrors(built.errors);
      toast.error("چند مقدار نیاز به اصلاح دارند.");
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await api<{ config: ShippingConfigJson }>("PUT", "/shipping/config", { body: built.body });
      const saved = toDraft(r.config);
      setState({ draft: saved, original: JSON.stringify(saved) });
      toast.success("تنظیمات ارسال ذخیره شد.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "shipping_config_changed" && (e.detail as { config?: ShippingConfigJson } | undefined)?.config) setStale((e.detail as { config: ShippingConfigJson }).config);
      else if (e instanceof ApiError && e.status === 422) {
        const notes = serverErrors(e);
        setServerNotes(notes.length > 0 ? notes : [apiErrorMessage(e)]);
        toast.error("ذخیره نشد؛ توضیح بالای صفحه را ببینید.");
      } else toast.error(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="page-head"><h1>ارسال و تحویل</h1></div>
      <Alert tone="info">
        قیمت ارسال را خودتان تعیین می‌کنید؛ هیچ سرویس بیرونی وصل نیست. مشتری فقط روش‌هایی را می‌بیند که فعال کرده‌اید و برایشان نرخ نوشته‌اید. هزینه را همیشه سرور حساب می‌کند. اگر برای یک مقصد هم نرخ شهری و هم نرخ استانی نوشته باشید، نرخ شهری (مشخص‌تر) اعمال می‌شود.
      </Alert>
      {stale && (
        <Alert
          tone="warn"
          title="تنظیمات در همین فاصله تغییر کرده است"
          action={<Button onClick={() => { const d = toDraft(stale); setState({ draft: d, original: JSON.stringify(d) }); setStale(null); setErrors({}); }}>بارگذاری آخرین نسخه (تغییرات من پاک می‌شود)</Button>}
        >
          شخص دیگری تنظیمات ارسال را ذخیره کرده است. چیزی روی آن نوشته نشد.
        </Alert>
      )}
      {serverNotes.length > 0 && (
        <Alert tone="error" title="ذخیره نشد">
          <ul>{serverNotes.map((n) => <li key={n}>{n}</li>)}</ul>
        </Alert>
      )}

      <section className="card stack" aria-labelledby="s-weights">
        <h2 id="s-weights">وزن پیش‌فرض</h2>
        <p className="hint">برای محصولی که وزنش را ننوشته‌اید، این وزن برای هر عدد حساب می‌شود. وزن هر محصول را در ویرایش محصول بنویسید.</p>
        <div className="form-grid cols-2">
          <NumberField label="وزن پیش‌فرض هر عدد (گرم)" required value={draft.defaultItemWeight} readOnly={!writable} error={errors.defaultItemWeight} onChange={(e) => { update({ ...draft, defaultItemWeight: e.target.value }); clearError("defaultItemWeight"); }} />
          <NumberField label="وزن بسته‌بندی هر سفارش (گرم)" hint="به وزن کل اضافه می‌شود." value={draft.packagingWeight} readOnly={!writable} error={errors.packagingWeight} onChange={(e) => { update({ ...draft, packagingWeight: e.target.value }); clearError("packagingWeight"); }} />
        </div>
      </section>

      <section className="card stack" aria-labelledby="s-free" data-testid="free-shipping">
        <div className="row between">
          <h2 id="s-free">ارسال رایگان</h2>
          <label className="check">
            <input type="checkbox" checked={draft.freeEnabled} disabled={!writable} onChange={(e) => { update({ ...draft, freeEnabled: e.target.checked }); clearError("freeThreshold"); clearError("freeMethods"); }} data-testid="enable-free" />
            <span>فعال</span>
          </label>
        </div>
        <p className="hint">وقتی جمع قیمت کالاهای سفارش (بدون هزینهٔ ارسال) به این مبلغ برسد، هزینهٔ ارسال روش‌های انتخاب‌شده صفر می‌شود. به مشتری هم نشان داده می‌شود چقدر دیگر خرید کند. مبلغ را هر وقت خواستید عوض کنید؛ سفارش‌های قبلی تغییر نمی‌کنند. فقط به مقصدهایی که برایشان نرخ نوشته‌اید ارسال رایگان می‌شود.</p>
        <NumberField label="حداقل جمع کالاها برای ارسال رایگان (تومان)" required={draft.freeEnabled} value={draft.freeThreshold} readOnly={!writable} error={errors.freeThreshold} onChange={(e) => { update({ ...draft, freeThreshold: e.target.value }); clearError("freeThreshold"); }} />
        <fieldset className="stack">
          <legend className="label-like">روش‌هایی که رایگان می‌شوند</legend>
          {draft.methods.filter((m) => methodNeedsAddress(m.method)).map((m) => (
            <label key={m.method} className="check">
              <input
                type="checkbox"
                checked={draft.freeMethods.includes(m.method)}
                disabled={!writable}
                onChange={(e) => { update({ ...draft, freeMethods: e.target.checked ? [...draft.freeMethods, m.method] : draft.freeMethods.filter((x) => x !== m.method) }); clearError("freeMethods"); }}
                data-testid={`free-method-${m.method}`}
              />
              <span>{SHIPPING_METHOD_LABEL[m.method]}</span>
            </label>
          ))}
          <p className="hint">تحویل حضوری همیشه بدون هزینه است.</p>
          {errors.freeMethods && <p className="error" role="alert">{errors.freeMethods}</p>}
        </fieldset>
      </section>

      {draft.methods.map((m) => {
        const carried = methodNeedsAddress(m.method);
        const at = (field: string) => `m.${m.method}.${field}`;
        return (
          <section key={m.method} className="card stack" aria-labelledby={`s-${m.method}`} data-testid={`method-${m.method}`}>
            <div className="row between">
              <h2 id={`s-${m.method}`}>{SHIPPING_METHOD_LABEL[m.method]}</h2>
              <label className="check">
                <input type="checkbox" checked={m.enabled} disabled={!writable} onChange={(e) => patchMethod(m.method, { enabled: e.target.checked })} data-testid={`enable-${m.method}`} />
                <span>فعال برای مشتریان</span>
              </label>
            </div>
            {!carried && <p className="hint">در تحویل حضوری مشتری نشانی نمی‌نویسد و هزینه‌ای ندارد. محل و ساعت تحویل را در توضیحات بنویسید.</p>}
            <div className="form-grid cols-2">
              <NumberField label="زمان تحویل: حداقل (روز)" value={m.etaMin} readOnly={!writable} error={errors[at("etaMin")]} onChange={(e) => { patchMethod(m.method, { etaMin: e.target.value }); clearError(at("etaMin")); }} />
              <NumberField label="زمان تحویل: حداکثر (روز)" value={m.etaMax} readOnly={!writable} error={errors[at("etaMax")]} onChange={(e) => { patchMethod(m.method, { etaMax: e.target.value }); clearError(at("etaMax")); }} />
            </div>
            <p className="hint">اگر زمان را ننویسید، به مشتری وعدهٔ زمانی داده نمی‌شود.</p>
            <TextAreaField label="توضیحات برای مشتری (اختیاری)" rows={2} value={m.note} readOnly={!writable} counter={{ value: m.note.length, max: 300 }} onChange={(e) => patchMethod(m.method, { note: e.target.value })} />
            {carried && (
              <>
                <h3>نرخ‌ها بر اساس مقصد و وزن</h3>
                {m.rates.length === 0 && <p className="hint">هنوز نرخی ننوشته‌اید.</p>}
                {m.rates.map((r, index) => (
                  <div key={r.key} className="variant-card" data-testid={`rate-${m.method}-${index}`}>
                    <div className="row between">
                      <strong>نرخ {(index + 1).toLocaleString("fa-IR")}</strong>
                      {writable && <Button small variant="danger" onClick={() => patchMethod(m.method, { rates: m.rates.filter((x) => x.key !== r.key) })}>حذف نرخ</Button>}
                    </div>
                    <div className="stack">
                      <div>
                        <p className="label-like">استان‌ها</p>
                        {r.provinces.length === 0 ? (
                          <p className="hint">همهٔ کشور</p>
                        ) : (
                          <ul className="chips" aria-label="استان‌های این نرخ">
                            {r.provinces.map((p) => (
                              <li key={p}>
                                {p}
                                {writable && <button type="button" className="chip-x" aria-label={`حذف ${p}`} onClick={() => patchRate(m.method, r.key, { provinces: r.provinces.filter((x) => x !== p) })}>×</button>}
                              </li>
                            ))}
                          </ul>
                        )}
                        {writable && (
                          <SelectField
                            label="افزودن استان"
                            value=""
                            onChange={(e) => e.target.value && !r.provinces.includes(e.target.value) && patchRate(m.method, r.key, { provinces: [...r.provinces, e.target.value] })}
                            options={[{ value: "", label: "انتخاب استان…" }, ...IRAN_PROVINCES.filter((p) => !r.provinces.includes(p)).map((p) => ({ value: p, label: p }))]}
                          />
                        )}
                      </div>
                      <TextField label="شهرها (اختیاری)" hint="با ویرگول جدا کنید. خالی = همهٔ شهرهای این استان‌ها. برای نرخ شهری حتماً استان را هم انتخاب کنید." value={r.cities} readOnly={!writable} onChange={(e) => patchRate(m.method, r.key, { cities: e.target.value })} />
                      <div className="form-grid cols-2">
                        <NumberField label="از وزن (گرم)" value={r.minWeight} readOnly={!writable} error={errors[at(`rate.${r.key}.minWeight`)]} onChange={(e) => { patchRate(m.method, r.key, { minWeight: e.target.value }); clearError(at(`rate.${r.key}.minWeight`)); }} />
                        <NumberField label="تا وزن (گرم)" hint="خالی = بدون سقف" value={r.maxWeight} readOnly={!writable} error={errors[at(`rate.${r.key}.maxWeight`)]} onChange={(e) => { patchRate(m.method, r.key, { maxWeight: e.target.value }); clearError(at(`rate.${r.key}.maxWeight`)); }} />
                      </div>
                      <NumberField label="هزینهٔ ارسال (تومان)" required hint="برای ارسال رایگان ۰ بنویسید." value={r.price} readOnly={!writable} error={errors[at(`rate.${r.key}.price`)]} onChange={(e) => { patchRate(m.method, r.key, { price: e.target.value }); clearError(at(`rate.${r.key}.price`)); }} />
                    </div>
                  </div>
                ))}
                {writable && m.rates.length < 200 && (
                  <Button onClick={() => patchMethod(m.method, { rates: [...m.rates, { key: newKey(), provinces: [], cities: "", minWeight: "0", maxWeight: "", price: "" }] })} data-testid={`add-rate-${m.method}`}>افزودن نرخ</Button>
                )}
              </>
            )}
          </section>
        );
      })}

      {writable ? (
        <div className="row sticky-actions">
          <Button variant="primary" loading={busy} disabled={!dirty} onClick={() => void save()} data-testid="save-shipping">ذخیرهٔ تنظیمات ارسال</Button>
          {dirty ? <span className="muted">تغییرات ذخیره‌نشده دارید.</span> : <span className="muted">همه‌چیز ذخیره است.</span>}
        </div>
      ) : (
        <Alert tone="info">فقط مالک می‌تواند این تنظیمات را تغییر دهد.</Alert>
      )}
    </div>
  );
}

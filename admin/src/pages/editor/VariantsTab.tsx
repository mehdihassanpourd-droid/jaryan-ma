import { MAX_OPTION_NAMES, moveItem, newVariantId } from "../../lib/product-form";
import { Alert } from "../../ui/feedback";
import { Button, NumberField, TextField } from "../../ui/controls";
import type { TabProps } from "./types";

export function VariantsTab({ form, setForm, errors, readOnly }: TabProps) {
  if (form.fulfillment === "unique") {
    return <Alert>اثر یگانه گونه ندارد. اگر چند رنگ یا اندازه دارید، «نوع تحویل» را روی «موجودی‌دار» یا «سفارشی» بگذارید.</Alert>;
  }
  const stocked = form.fulfillment === "stocked";
  const patchVariant = (i: number, patch: Partial<(typeof form.variants)[number]>) => setForm((f) => ({ ...f, variants: f.variants.map((v, k) => (k === i ? { ...v, ...patch } : v)) }));

  const addVariant = () =>
    setForm((f) => ({
      ...f,
      optionNames: f.optionNames.length === 0 ? ["اندازه"] : f.optionNames,
      variants: [...f.variants, { id: newVariantId(), sku: "", values: (f.optionNames.length === 0 ? ["اندازه"] : f.optionNames).map(() => ""), price: "", inventory: stocked ? "0" : "" }],
    }));

  const renameOption = (k: number, name: string) => setForm((f) => ({ ...f, optionNames: f.optionNames.map((n, i) => (i === k ? name : n)) }));
  const addOption = () => setForm((f) => ({ ...f, optionNames: [...f.optionNames, ""], variants: f.variants.map((v) => ({ ...v, values: [...v.values, ""] })) }));
  const removeOption = (k: number) => setForm((f) => ({ ...f, optionNames: f.optionNames.filter((_, i) => i !== k), variants: f.variants.map((v) => ({ ...v, values: v.values.filter((_, i) => i !== k) })) }));

  return (
    <div className="stack">
      <p className="hint">هر گونه یک ترکیب از ویژگی‌هاست (مثلاً رنگ و اندازه) با کد کالای (SKU) یکتا، قیمت و موجودی خودش.</p>

      {form.variants.length > 0 && (
        <fieldset className="card stack">
          <legend>ویژگی‌ها (حداکثر {MAX_OPTION_NAMES})</legend>
          {form.optionNames.map((name, k) => (
            <div className="row" key={k}>
              <TextField label={`نام ویژگی ${k + 1}`} value={name} readOnly={readOnly} onChange={(e) => renameOption(k, e.target.value)} />
              {!readOnly && form.optionNames.length > 1 && <Button small variant="ghost" onClick={() => removeOption(k)}>حذف ویژگی</Button>}
            </div>
          ))}
          {!readOnly && form.optionNames.length < MAX_OPTION_NAMES && <Button small onClick={addOption}>افزودن ویژگی</Button>}
        </fieldset>
      )}

      {form.variants.map((v, i) => (
        <section key={v.id} className="variant-card" aria-label={`گونه ${i + 1}`}>
          <div className="row between">
            <strong>گونه {(i + 1).toLocaleString("fa-IR")}</strong>
            {!readOnly && (
              <span className="row">
                <Button small variant="ghost" disabled={i === 0} aria-label="انتقال گونه به بالا" onClick={() => setForm((f) => ({ ...f, variants: moveItem(f.variants, i, i - 1) }))}>▲</Button>
                <Button small variant="ghost" disabled={i === form.variants.length - 1} aria-label="انتقال گونه به پایین" onClick={() => setForm((f) => ({ ...f, variants: moveItem(f.variants, i, i + 1) }))}>▼</Button>
                <Button small variant="danger" onClick={() => setForm((f) => ({ ...f, variants: f.variants.filter((_, k) => k !== i) }))}>حذف</Button>
              </span>
            )}
          </div>
          {errors[`variants.${i}.options`] && <p className="error" role="alert">{errors[`variants.${i}.options`]}</p>}
          <div className="form-grid">
            {form.optionNames.map((name, k) => (
              <TextField key={k} label={name || `ویژگی ${k + 1}`} value={v.values[k] ?? ""} readOnly={readOnly} onChange={(e) => patchVariant(i, { values: v.values.map((x, idx) => (idx === k ? e.target.value : x)) })} />
            ))}
          </div>
          <div className="form-grid">
            <TextField label="کد کالا (SKU)" required dir="ltr" className="ltr-input" value={v.sku} readOnly={readOnly} error={errors[`variants.${i}.sku`]} onChange={(e) => patchVariant(i, { sku: e.target.value })} />
            <NumberField label="قیمت (تومان)" inputMode="numeric" dir="ltr" className="ltr-input" value={v.price} readOnly={readOnly} error={errors[`variants.${i}.priceToman`]} onChange={(e) => patchVariant(i, { price: e.target.value })} />
            {stocked && <NumberField label="موجودی" inputMode="numeric" dir="ltr" className="ltr-input" value={v.inventory} readOnly={readOnly} error={errors[`variants.${i}.inventory`]} onChange={(e) => patchVariant(i, { inventory: e.target.value })} />}
          </div>
        </section>
      ))}
      {!readOnly && <Button onClick={addVariant}>افزودن گونه</Button>}
    </div>
  );
}

import { FULFILLMENTS, type Fulfillment } from "@/domain/product/types";
import { FULFILLMENT_LABELS } from "../../lib/product-form";
import { NumberField, SelectField, TextAreaField, TextField } from "../../ui/controls";
import type { TabProps } from "./types";

const INVENTORY_HINT: Record<Fulfillment, string> = {
  unique: "اثر یگانه فقط یک‌تکه است: موجودی ۰ یا ۱.",
  stocked: "اگر گونه (رنگ، اندازه…) دارید، موجودی را برای هر گونه جدا وارد کنید.",
  made_to_order: "محصول سفارشی موجودی ندارد؛ زمان آماده‌سازی را بنویسید.",
};

export function BasicsTab({ form, setForm, errors, categories, readOnly }: TabProps) {
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const hasVariants = form.fulfillment !== "unique" && form.variants.length > 0;
  return (
    <div className="stack">
      <TextField label="نام محصول" required value={form.name} readOnly={readOnly} error={errors.name} counter={{ value: form.name.length, max: 120 }} onChange={(e) => set("name", e.target.value)} />
      <TextAreaField label="توضیحات" rows={6} value={form.description} readOnly={readOnly} error={errors.description} onChange={(e) => set("description", e.target.value)} />
      <div className="form-grid">
        <SelectField
          label="دسته‌بندی"
          hint="برای انتشار لازم است."
          value={form.categoryId}
          disabled={readOnly}
          error={errors.categoryId}
          onChange={(e) => set("categoryId", e.target.value)}
          options={[{ value: "", label: "بدون دسته" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
        />
        <SelectField
          label="نوع تحویل"
          value={form.fulfillment}
          disabled={readOnly}
          error={errors.fulfillment}
          onChange={(e) => setForm((f) => ({ ...f, fulfillment: e.target.value as Fulfillment, inventory: e.target.value === "unique" ? "1" : f.inventory }))}
          options={FULFILLMENTS.map((x) => ({ value: x, label: FULFILLMENT_LABELS[x] }))}
        />
      </div>
      <NumberField label="قیمت (تومان)" hint="اگر هنوز قیمت نهایی نشده، خالی بگذارید؛ برای انتشار قیمت لازم است." inputMode="numeric" dir="ltr" className="ltr-input" value={form.price} readOnly={readOnly} error={errors.priceToman} onChange={(e) => set("price", e.target.value)} />
      {form.fulfillment === "made_to_order" ? (
        <NumberField label="زمان آماده‌سازی (روز)" required inputMode="numeric" dir="ltr" className="ltr-input" hint={INVENTORY_HINT.made_to_order} value={form.leadTimeDays} readOnly={readOnly} error={errors.leadTimeDays} onChange={(e) => set("leadTimeDays", e.target.value)} />
      ) : hasVariants ? (
        <p className="hint">موجودی از روی گونه‌ها (تب «گونه‌ها») محاسبه می‌شود.</p>
      ) : (
        <NumberField label="موجودی" inputMode="numeric" dir="ltr" className="ltr-input" hint={INVENTORY_HINT[form.fulfillment]} value={form.inventory} readOnly={readOnly} error={errors.inventory} onChange={(e) => set("inventory", e.target.value)} />
      )}
      <TextField label="نشانی (اسلاگ)" hint="اختیاری. خالی بگذارید تا از نام ساخته شود. با انتشار، نشانی در آدرس صفحه می‌آید." dir="ltr" className="ltr-input" value={form.slug} readOnly={readOnly} error={errors.slug} onChange={(e) => set("slug", e.target.value)} />
    </div>
  );
}

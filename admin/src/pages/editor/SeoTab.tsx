import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from "@/domain/product/schema";
import { seoHints, suggestSeo } from "../../lib/seo-suggest";
import { Button, TextAreaField, TextField } from "../../ui/controls";
import type { TabProps } from "./types";

export function SeoTab({ form, setForm, errors, categories, readOnly }: TabProps) {
  const category = categories.find((c) => c.id === form.categoryId)?.name ?? null;
  const suggestion = suggestSeo(form, category);
  const title = form.seoTitle.trim() || suggestion.title;
  const description = form.seoDescription.trim() || suggestion.description;
  const missingAlt = form.images.filter((i) => !i.alt.trim()).length;
  const hints = seoHints(form.seoTitle, form.seoDescription, form.images.map((i) => i.alt), missingAlt);

  return (
    <div className="stack">
      <p className="hint">
        اگر این فیلدها را خالی بگذارید، عنوان و توضیح به‌طور خودکار فقط از اطلاعات واقعی محصول ساخته می‌شود. محصول نمونه یا پیش‌نویس هرگز در گوگل ایندکس نمی‌شود.
      </p>

      <div className="stack">
        <TextField label="عنوان سئو" value={form.seoTitle} readOnly={readOnly} error={errors.seoTitle} counter={{ value: form.seoTitle.length, max: SEO_TITLE_MAX }} onChange={(e) => setForm((f) => ({ ...f, seoTitle: e.target.value }))} />
        <TextAreaField label="توضیح سئو" rows={3} value={form.seoDescription} readOnly={readOnly} error={errors.seoDescription} counter={{ value: form.seoDescription.length, max: SEO_DESCRIPTION_MAX }} onChange={(e) => setForm((f) => ({ ...f, seoDescription: e.target.value }))} />
      </div>

      <section className="suggestion" aria-label="پیشنهاد خودکار">
        <strong>پیشنهاد خودکار</strong>
        <p><span className="muted">عنوان: </span>{suggestion.title}</p>
        <p><span className="muted">توضیح: </span>{suggestion.description}</p>
        {!readOnly && (
          <div className="row">
            <Button small onClick={() => setForm((f) => ({ ...f, seoTitle: suggestion.title.slice(0, SEO_TITLE_MAX) }))}>استفاده از عنوان</Button>
            <Button small onClick={() => setForm((f) => ({ ...f, seoDescription: suggestion.description.slice(0, SEO_DESCRIPTION_MAX) }))}>استفاده از توضیح</Button>
            {(form.seoTitle || form.seoDescription) && <Button small variant="ghost" onClick={() => setForm((f) => ({ ...f, seoTitle: "", seoDescription: "" }))}>بازگشت به خودکار</Button>}
          </div>
        )}
      </section>

      <section aria-label="پیش‌نمایش نتیجهٔ جست‌وجو">
        <strong>این‌گونه در گوگل دیده می‌شود (تقریبی)</strong>
        <div className="serp">
          <span className="url">…/products/{form.slug || "…"}</span>
          <span className="t">{title}</span>
          <span className="d">{description}</span>
        </div>
      </section>

      <ul className="hints" aria-label="راهنمای سئو">
        {hints.map((h) => <li key={h.text} className={h.level}>{h.level === "warn" ? "⚠ " : "✓ "}{h.text}</li>)}
      </ul>
      <p className="hint">متن جایگزین هر تصویر را در تب «تصاویر» ویرایش کنید.</p>
    </div>
  );
}

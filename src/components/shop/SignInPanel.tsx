"use client";

import { useState } from "react";
import type { CustomerProfile } from "@/lib/order-api";
import { OrderApiError } from "@/lib/order-api";
import { normalizeIranMobile } from "@/domain/phone";
import { orderApi } from "./orderClient";
import { Field } from "./Field";

const primary = "inline-flex min-h-12 items-center justify-center bg-bark-700 px-7 py-3 text-base font-medium text-ivory-50 hover:bg-bark-900 disabled:cursor-not-allowed disabled:opacity-60";

function errorText(error: unknown): string {
  if (!(error instanceof OrderApiError)) return "خطایی رخ داد. دوباره تلاش کنید.";
  if (error.code === "network") return "ارتباط با سرور برقرار نشد. اینترنت خود را بررسی کنید و دوباره تلاش کنید.";
  if (error.code === "rate_limited") return `تلاش‌های پشت‌سرهم زیاد بود؛ ${error.detail.retryAfterSeconds ?? 60} ثانیه دیگر دوباره امتحان کنید.`;
  if (error.code === "sms_unavailable") return "ارسال پیامک در حال حاضر ممکن نیست.";
  if (error.code === "invalid_code") return "کد نادرست یا منقضی شده است.";
  if (error.code === "account_suspended") return "این حساب فعال نیست.";
  if (error.status === 422) return "شمارهٔ موبایل معتبر نیست؛ مثل ۰۹۱۲۳۴۵۶۷۸۹ بنویسید.";
  return "خطایی رخ داد. دوباره تلاش کنید.";
}

/**
 * Sign-in with a one-time SMS code (the only way in: no passwords, no guest accounts). `onUnavailable` lets the page
 * offer another way to order when the SMS service is not available.
 */
export function SignInPanel({ onSignedIn, onUnavailable }: { onSignedIn: (customer: CustomerProfile) => void; onUnavailable?: () => void }) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [terms, setTerms] = useState(false);
  const [needTerms, setNeedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!orderApi) return null;
  const api = orderApi;

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!normalizeIranMobile(phone)) return setError("شمارهٔ موبایل معتبر نیست؛ مثل ۰۹۱۲۳۴۵۶۷۸۹ بنویسید.");
    setBusy(true);
    setError(null);
    try {
      await api.requestCode(phone);
      setStep("code");
    } catch (err) {
      setError(errorText(err));
      if (err instanceof OrderApiError && err.code === "sms_unavailable") onUnavailable?.();
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.verify(phone, code, terms));
    } catch (err) {
      if (err instanceof OrderApiError && err.code === "terms_required") {
        setNeedTerms(true);
        setError("برای ساخت حساب تازه، پذیرفتن شرایط استفاده لازم است.");
      } else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="signin-title" className=" border border-sand-200 bg-ivory-50 p-5 sm:p-6" data-testid="signin">
      <h2 id="signin-title" className="text-lg font-bold text-bark-900">ورود با کد پیامکی</h2>
      <p className="mt-1 text-sm leading-7 text-bark-600">برای ثبت سفارش و دیدن سابقهٔ سفارش‌ها، شمارهٔ موبایل خود را تأیید کنید. رمز عبور لازم نیست.</p>
      {step === "phone" ? (
        <form onSubmit={sendCode} className="mt-4 space-y-4" noValidate>
          <Field label="شمارهٔ موبایل" required error={error ?? undefined}>
            {(p) => <input {...p} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="09123456789" value={phone} onChange={(e) => setPhone(e.target.value)} className={`${p.className} text-start`} />}
          </Field>
          <button type="submit" className={primary} disabled={busy}>{busy ? "در حال ارسال…" : "دریافت کد"}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-4 space-y-4" noValidate>
          <p className="text-sm text-bark-700">کد ۶ رقمی به <span dir="ltr">{phone}</span> فرستاده شد.</p>
          <Field label="کد تأیید" required error={error ?? undefined}>
            {(p) => <input {...p} type="text" inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={12} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} className={`${p.className} text-start tracking-widest`} />}
          </Field>
          {needTerms && (
            <label className="flex items-start gap-3 text-sm leading-7 text-bark-800">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1.5 h-5 w-5 accent-bark-700" />
              <span>شرایط استفاده و سیاست حریم خصوصی فروشگاه را می‌پذیرم.</span>
            </label>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={primary} disabled={busy || code.trim() === ""}>{busy ? "در حال بررسی…" : "تأیید و ورود"}</button>
            <button type="button" onClick={() => { setStep("phone"); setCode(""); setError(null); setNeedTerms(false); }} className="min-h-11 px-3 text-sm text-bark-700 underline">اصلاح شماره</button>
          </div>
        </form>
      )}
    </section>
  );
}

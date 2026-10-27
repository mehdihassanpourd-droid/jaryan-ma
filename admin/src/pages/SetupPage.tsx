import { useState, type FormEvent } from "react";
import { ApiError, api } from "../api/client";
import { apiErrorMessage } from "../lib/errors";
import { Button, TextField } from "../ui/controls";
import { Alert, useToast } from "../ui/feedback";

interface Begin {
  token: string;
  secret: string;
  otpauthUri: string;
  expiresInSeconds: number;
}

const POLICY_TEXT: Record<string, string> = {
  too_short: "گذرواژه باید دست‌کم ۱۲ نویسه باشد.",
  too_long: "گذرواژه بیش از حد بلند است.",
  contains_email: "گذرواژه نباید شامل بخشی از ایمیل باشد.",
  too_common: "این گذرواژه بیش از حد رایج است.",
  low_variety: "گذرواژه تنوع نویسهٔ کافی ندارد.",
};

function setupMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "weak_password") {
      const issues = error.issues as unknown as string[];
      return issues.map((i) => POLICY_TEXT[i]).filter(Boolean).join(" ") || "گذرواژه به‌اندازه کافی قوی نیست.";
    }
    if (error.code === "invalid_email") return "ایمیل معتبر نیست.";
    if (error.code === "setup_closed") return "ساخت مدیر اول بسته شده است؛ از صفحهٔ ورود استفاده کنید.";
    if (error.code === "setup_expired") return "مهلت ۱۰ دقیقه‌ای تمام شد. دوباره از اول شروع کنید.";
  }
  return apiErrorMessage(error);
}

/**
 * First-run only (development environments such as a Codespace): the server offers this page while there is no
 * administrator. It creates the same account as the command-line tool: strong password and a mandatory authenticator
 * (TOTP) that must be proven with a current code before anything is saved. It never appears once an account exists.
 */
export function SetupPage({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [enroll, setEnroll] = useState<Begin | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function begin(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== repeat) return setError("گذرواژه و تکرار آن یکسان نیست.");
    setBusy(true);
    try {
      setEnroll(await api<Begin>("POST", "/setup/begin", { body: { email: email.trim(), password }, anonymous: true }));
    } catch (e) {
      setError(setupMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function finish(event: FormEvent) {
    event.preventDefault();
    if (!enroll) return;
    setError(null);
    setBusy(true);
    try {
      await api("POST", "/setup/finish", { body: { token: enroll.token, code: code.trim() }, anonymous: true });
      toast.success("مدیر ساخته شد. اکنون با ایمیل، گذرواژه و یک کد تازه وارد شوید.");
      onDone();
    } catch (e) {
      if (e instanceof ApiError && (e.code === "setup_expired" || e.code === "setup_closed")) setEnroll(null);
      setError(setupMessage(e));
      if (e instanceof ApiError && e.code === "invalid_totp") setCode("");
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    if (!enroll) return;
    try {
      await navigator.clipboard.writeText(enroll.secret);
      toast.success("کلید کپی شد.");
    } catch {
      toast.error("کپی نشد؛ کلید را با لمس طولانی انتخاب و کپی کنید.");
    }
  }

  return (
    <div className="login-wrap">
      <main className="card login-card" id="main">
        <img className="logo" src="/admin/icons/icon-192.png" alt="" width="72" height="72" />
        <h1 className="login-title">ساخت مدیر اول</h1>
        <Alert tone="info">
          هنوز هیچ مدیری وجود ندارد. این صفحه فقط در محیط آزمایشی نمایش داده می‌شود و پس از ساخت اولین مدیر برای همیشه بسته می‌شود. ورود دومرحله‌ای (کد برنامهٔ احراز هویت) اجباری است.
        </Alert>
        {error ? <Alert tone="error">{error}</Alert> : null}

        {!enroll ? (
          <form className="stack" onSubmit={begin} noValidate>
            <TextField label="ایمیل" type="email" dir="ltr" className="ltr-input" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <TextField label="گذرواژه" type="password" dir="ltr" className="ltr-input" autoComplete="new-password" required hint="دست‌کم ۱۲ نویسه؛ یکتا و جدا از گذرواژه‌های دیگرتان." value={password} onChange={(e) => setPassword(e.target.value)} />
            <TextField label="تکرار گذرواژه" type="password" dir="ltr" className="ltr-input" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />
            <Button type="submit" variant="primary" loading={busy} disabled={!email || !password || !repeat}>
              ادامه
            </Button>
          </form>
        ) : (
          <form className="stack" onSubmit={finish} noValidate>
            <p>۱. این حساب را به برنامهٔ احراز هویت (Google Authenticator، Aegis، 2FAS …) اضافه کنید:</p>
            <a className="btn btn-primary" href={enroll.otpauthUri}>
              افزودن به برنامهٔ احراز هویت
            </a>
            <p className="hint">اگر دکمهٔ بالا برنامه را باز نکرد، کلید زیر را دستی وارد کنید («Enter a setup key»، نوع زمان‌محور):</p>
            <TextField label="کلید راه‌اندازی" dir="ltr" className="ltr-input" readOnly value={enroll.secret.replace(/(.{4})/g, "$1 ").trim()} onFocus={(e) => e.currentTarget.select()} />
            <Button onClick={() => void copySecret()}>کپی کلید</Button>
            <p>۲. کد ۶ رقمی که برنامه نشان می‌دهد را وارد کنید تا ثابت شود درست کار می‌کند:</p>
            <TextField label="کد ۶ رقمی" dir="ltr" className="ltr-input" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required value={code} onChange={(e) => setCode(e.target.value)} />
            <Button type="submit" variant="primary" loading={busy} disabled={code.trim().length < 6}>
              ساخت مدیر
            </Button>
            <Button variant="ghost" onClick={() => setEnroll(null)}>
              بازگشت
            </Button>
          </form>
        )}
      </main>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { ApiError, api } from "../api/client";
import { apiErrorMessage } from "../lib/errors";
import { useSession } from "../session";
import { Button, TextField } from "../ui/controls";
import { Alert } from "../ui/feedback";
import { SetupPage } from "./SetupPage";

export function LoginPage({ expired }: { expired: boolean }) {
  const { login } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only a development server with ZERO administrators answers `open: true`; anything else (or an error) means "sign in".
  const [setupOpen, setSetupOpen] = useState(false);
  const [build, setBuild] = useState<string | null>(null); // development servers say which commit they run

  useEffect(() => {
    api<{ open: boolean; build?: string }>("GET", "/setup/status", { anonymous: true }).then(
      (r) => {
        setSetupOpen(r.open === true);
        setBuild(typeof r.build === "string" ? r.build : null);
      },
      () => setSetupOpen(false),
    );
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ email: email.trim(), password, totp: totp.trim() || undefined });
    } catch (e) {
      if (e instanceof ApiError && e.code === "totp_required") setNeedTotp(true);
      setError(apiErrorMessage(e));
      if (e instanceof ApiError && e.code === "invalid_totp") setTotp("");
    } finally {
      setBusy(false);
    }
  }

  if (setupOpen) return <SetupPage onDone={() => setSetupOpen(false)} build={build} />;

  return (
    <div className="login-wrap">
      <main className="card login-card" id="main">
        <img className="logo" src="/admin/icons/icon-192.png" alt="" width="72" height="72" />
        <h1 className="login-title">ورود به مدیریت جریان ما</h1>
        {expired && !error ? <Alert tone="warn">نشست شما پایان یافته است. دوباره وارد شوید.</Alert> : null}
        {error ? <Alert tone="error">{error}</Alert> : null}
        <form className="stack" onSubmit={submit} noValidate>
          <TextField label="ایمیل" type="email" dir="ltr" className="ltr-input" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextField label="گذرواژه" type="password" dir="ltr" className="ltr-input" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <TextField
            label="کد دومرحله‌ای (۶ رقم)"
            hint="کد برنامهٔ احراز هویت (Authenticator) را وارد کنید. ورود بدون آن ممکن نیست."
            dir="ltr"
            className="ltr-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            required={needTotp}
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
          />
          <Button type="submit" variant="primary" loading={busy} disabled={!email || !password}>
            ورود
          </Button>
        </form>
        {build ? <p className="hint">نسخهٔ سرور آزمایشی: <bdi dir="ltr">{build}</bdi></p> : null}
      </main>
    </div>
  );
}

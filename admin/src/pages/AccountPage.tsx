import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api/client";
import { apiErrorMessage } from "../lib/errors";
import { useSession, useUser } from "../session";
import { Button, TextField } from "../ui/controls";
import { Alert, Badge, useToast } from "../ui/feedback";

const ROLE_LABELS: Record<string, string> = { owner: "مالک", editor: "ویرایشگر", support: "پشتیبان", viewer: "مشاهده‌گر" };

interface InstallEvent extends Event {
  prompt(): Promise<unknown>;
}

export function AccountPage() {
  const user = useUser();
  const { logout } = useSession();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/auth/password", { body: { current, next } });
      toast.success("گذرواژه تغییر کرد.");
      setCurrent("");
      setNext("");
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="page-head"><h1>حساب من</h1></div>
      <section className="card stack" aria-label="مشخصات">
        <p><span className="muted">ایمیل: </span><span dir="ltr">{user.email}</span></p>
        <p><span className="muted">نقش: </span><Badge tone="olive">{ROLE_LABELS[user.role] ?? user.role}</Badge></p>
        <p className="hint">ورود دومرحله‌ای (TOTP) برای همهٔ حساب‌ها اجباری است. فعال‌سازی یا بازنشانی آن فقط با دستور مدیریتی روی سرور انجام می‌شود.</p>
      </section>

      <form className="card stack" onSubmit={changePassword} noValidate aria-labelledby="pw-h">
        <h2 id="pw-h">تغییر گذرواژه</h2>
        {error && <Alert tone="error">{error}</Alert>}
        <TextField label="گذرواژه فعلی" type="password" dir="ltr" className="ltr-input" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <TextField label="گذرواژه جدید" type="password" dir="ltr" className="ltr-input" autoComplete="new-password" hint="دست‌کم ۱۲ نویسه؛ گذرواژهٔ رایج پذیرفته نمی‌شود." value={next} onChange={(e) => setNext(e.target.value)} />
        <Button type="submit" variant="primary" loading={busy} disabled={!current || !next}>تغییر گذرواژه</Button>
      </form>

      {installEvent && (
        <section className="card stack" aria-label="نصب برنامه">
          <p>این پنل را مثل یک برنامه روی گوشی نصب کنید.</p>
          <Button onClick={() => void installEvent.prompt()}>نصب برنامه</Button>
        </section>
      )}

      <Button variant="danger" onClick={() => void logout()}>خروج از حساب</Button>
    </div>
  );
}

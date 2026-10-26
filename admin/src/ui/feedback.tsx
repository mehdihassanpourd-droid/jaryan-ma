import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatNumber } from "@/lib/format";

export function Spinner({ small = false }: { small?: boolean }) {
  return <span className={`spinner${small ? " spinner-small" : ""}`} aria-hidden="true" />;
}

/** A page-level loading state that is announced to screen readers. */
export function Loading({ label = "در حال بارگذاری…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function Alert({ tone = "info", title, children, action }: { tone?: "info" | "success" | "warn" | "error"; title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <div>
        {title && <strong className="alert-title">{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action && <div className="alert-action">{action}</div>}
    </div>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "olive" | "warn" | "muted"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="صفحه‌بندی">
      <button type="button" className="btn btn-secondary btn-small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        قبلی
      </button>
      <span aria-live="polite">
        صفحه {formatNumber(page)} از {formatNumber(pages)}
      </span>
      <button type="button" className="btn btn-secondary btn-small" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        بعدی
      </button>
    </nav>
  );
}

// ---- toasts -----------------------------------------------------------------------------------------------

interface Toast {
  id: number;
  tone: "success" | "error";
  text: string;
}
interface ToastApi {
  success(text: string): void;
  error(text: string): void;
}
const ToastCtx = createContext<ToastApi | null>(null);

/** Short success/error messages. Success is announced politely, errors assertively; both disappear on their own. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = next.current++;
    setToasts((list) => [...list.slice(-2), { id, tone, text }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === "error" ? 9000 : 4500);
  }, []);
  const api = useMemo<ToastApi>(() => ({ success: (t) => push("success", t), error: (t) => push("error", t) }), [push]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastCtx);
  if (!value) throw new Error("useToast outside ToastProvider");
  return value;
}

// ---- confirmation dialog ----------------------------------------------------------------------------------

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}
type Confirm = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmCtx = createContext<Confirm | null>(null);

/** Promise-based confirmation using the native <dialog> (focus trap, Escape and backdrop come for free). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const confirm = useCallback<Confirm>((options) => new Promise((resolve) => setPending({ ...options, resolve })), []);

  useEffect(() => {
    const dialog = ref.current;
    if (pending && dialog && !dialog.open) dialog.showModal();
  }, [pending]);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    ref.current?.close();
    setPending(null);
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {pending && (
        <dialog ref={ref} className="dialog" aria-labelledby="confirm-title" onCancel={(e) => (e.preventDefault(), close(false))}>
          <h2 id="confirm-title">{pending.title}</h2>
          {pending.message && <p>{pending.message}</p>}
          <div className="dialog-actions">
            <button type="button" className={`btn ${pending.danger ? "btn-danger" : "btn-primary"}`} onClick={() => close(true)} autoFocus>
              {pending.confirmLabel ?? "تأیید"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => close(false)}>
              انصراف
            </button>
          </div>
        </dialog>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm(): Confirm {
  const value = useContext(ConfirmCtx);
  if (!value) throw new Error("useConfirm outside ConfirmProvider");
  return value;
}

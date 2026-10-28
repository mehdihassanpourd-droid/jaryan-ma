import { useId, type ReactNode } from "react";

const control = "block min-h-12 w-full border border-sand-300 bg-ivory-50 px-4 py-3 text-base text-bark-900 placeholder:text-bark-500 focus:border-olive-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive-700 aria-[invalid=true]:border-red-700";

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  required?: boolean;
  /** Renders the control; spread the given props on it. */
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby": string | undefined; className: string }) => ReactNode;
}

/** Labelled form field: 16px text (no zoom on phones), ≥48px tall, error and hint tied to the control. */
export function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-bark-800">
        {label}
        {required && <span aria-hidden="true" className="ms-1 text-red-700">*</span>}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy, className: control })}
      {hint && <p id={`${id}-hint`} className="text-xs text-bark-600">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="text-sm text-red-800">{error}</p>}
    </div>
  );
}

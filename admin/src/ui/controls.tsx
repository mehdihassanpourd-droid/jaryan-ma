import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ButtonHTMLAttributes } from "react";
import { Spinner } from "./feedback";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  small?: boolean;
}

/** Touch-friendly (min 44px) button. While `loading` it stays focusable but ignores clicks and says it is busy. */
export function Button({ variant = "secondary", loading = false, small = false, className = "", children, disabled, onClick, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      className={`btn btn-${variant}${small ? " btn-small" : ""}${className ? ` ${className}` : ""}`}
      onClick={loading ? undefined : onClick}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

interface FieldShell {
  label: string;
  hint?: string;
  error?: string;
  /** Shown as "n / max" under the field. */
  counter?: { value: number; max: number };
  required?: boolean;
}

function Shell({ id, label, hint, error, counter, required, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={`field${error ? " field-error" : ""}`}>
      <label htmlFor={id}>
        {label}
        {required && (
          <span className="req" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {counter && (
        <p className={`hint counter${counter.value > counter.max ? " over" : ""}`} aria-hidden="true">
          <span dir="ltr">{counter.value} / {counter.max}</span>
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string) => [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;

type TextProps = FieldShell & Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & { fieldId?: string };

export function TextField({ label, hint, error, counter, required, fieldId, ...input }: TextProps) {
  const generated = useId();
  const id = fieldId ?? generated;
  return (
    <Shell id={id} label={label} hint={hint} error={error} counter={counter} required={required}>
      <input {...input} id={id} required={required} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} />
    </Shell>
  );
}

/** Whole numbers (prices, stock): numeric keypad on phones, digits shown left-to-right so long numbers read correctly. */
export function NumberField(props: TextProps) {
  return <TextField {...props} type="text" inputMode="numeric" dir="ltr" autoComplete="off" className={`ltr-input ${props.className ?? ""}`} />;
}

type AreaProps = FieldShell & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & { fieldId?: string };

export function TextAreaField({ label, hint, error, counter, required, fieldId, ...area }: AreaProps) {
  const generated = useId();
  const id = fieldId ?? generated;
  return (
    <Shell id={id} label={label} hint={hint} error={error} counter={counter} required={required}>
      <textarea {...area} id={id} required={required} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} />
    </Shell>
  );
}

type SelectProps = FieldShell & Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & { fieldId?: string; options: Array<{ value: string; label: string }> };

export function SelectField({ label, hint, error, counter, required, fieldId, options, ...select }: SelectProps) {
  const generated = useId();
  const id = fieldId ?? generated;
  return (
    <Shell id={id} label={label} hint={hint} error={error} counter={counter} required={required}>
      <select {...select} id={id} required={required} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

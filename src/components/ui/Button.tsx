import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-medium transition-colors duration-200";

const variants: Record<Variant, string> = {
  primary: "bg-bark-700 text-ivory-50 hover:bg-bark-900",
  secondary: "border border-bark-500/40 text-bark-700 hover:bg-sand-100",
  ghost: "text-bark-600 hover:text-bark-900",
};

interface ButtonLinkProps extends Omit<ComponentProps<typeof Link>, "className"> {
  variant?: Variant;
  className?: string;
}

/** Link styled as a button. Use for navigation; there are no form actions yet. */
export function ButtonLink({ variant = "primary", className = "", ...props }: ButtonLinkProps) {
  return <Link className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

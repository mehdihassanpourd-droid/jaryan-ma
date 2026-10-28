import Link from "next/link";
import type { ComponentProps } from "react";
import { Icon } from "./Icons";

type Variant = "primary" | "secondary" | "ghost" | "light" | "onDark" | "accent";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors duration-200";

const sizes: Record<Size, string> = {
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3.5 text-base",
};

const variants: Record<Variant, string> = {
  primary: "bg-bark-900 text-ivory-50 hover:bg-teal-800",
  secondary: "border border-bark-900/35 text-bark-900 hover:bg-sand-100",
  ghost: "text-bark-600 hover:text-bark-900",
  light: "bg-ivory-50 text-bark-900 hover:bg-sand-100",
  onDark: "border border-ivory-50/75 text-ivory-50 hover:bg-ivory-50/10",
  accent: "bg-clay-600 text-ivory-50 hover:bg-clay-700",
};

interface ButtonLinkProps extends Omit<ComponentProps<typeof Link>, "className"> {
  variant?: Variant;
  size?: Size;
  className?: string;
  /** The reference's pill ends with a small chevron that points the reading direction. */
  chevron?: boolean;
}

/** Link styled as a button. Use for navigation; there are no form actions yet. */
export function ButtonLink({ variant = "primary", size = "md", className = "", chevron = false, children, ...props }: ButtonLinkProps) {
  return (
    <Link className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props}>
      {children}
      {chevron && <Icon name="chevron" className="h-4 w-4" />}
    </Link>
  );
}

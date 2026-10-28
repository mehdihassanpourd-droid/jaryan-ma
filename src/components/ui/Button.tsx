import Link from "next/link";
import type { ComponentProps } from "react";
import { Icon } from "./Icons";

type Variant = "primary" | "secondary" | "ghost" | "light" | "onDark" | "accent";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2  font-bold transition-colors duration-200";

const sizes: Record<Size, string> = {
  md: "px-5 py-2.5 text-sm",
  lg: "px-8 py-4 text-base",
};

const variants: Record<Variant, string> = {
  primary: "bg-bark-900 text-ivory-50 hover:bg-clay-600",
  secondary: "border-2 border-bark-900 text-bark-900 hover:bg-bark-900 hover:text-ivory-50",
  ghost: "text-bark-600 hover:text-bark-900",
  light: "bg-ivory-50 text-bark-900 hover:bg-clay-600 hover:text-ivory-50",
  onDark: "border-2 border-ivory-50 text-ivory-50 hover:bg-ivory-50 hover:text-bark-900",
  accent: "bg-clay-600 text-ivory-50 hover:bg-bark-900",
};

interface ButtonLinkProps extends Omit<ComponentProps<typeof Link>, "className"> {
  variant?: Variant;
  size?: Size;
 className?: string;
  /** A small arrow that points the reading direction. */
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

import type { SVGProps } from "react";

/** Small stroke icons (24px grid, `currentColor`). Decorative by default: put the label on the button or link. */
const paths = {
  home: <path d="M4.5 11 12 4.5 19.5 11v8.5h-5v-5h-5v5h-5z" />,
  grid: (
    <>
      <rect x="4.5" y="4.5" width="6" height="6" rx="1.6" />
      <rect x="13.5" y="4.5" width="6" height="6" rx="3" />
      <rect x="4.5" y="13.5" width="6" height="6" rx="3" />
      <rect x="13.5" y="13.5" width="6" height="6" rx="1.6" />
    </>
  ),
  bag: (
    <>
      <path d="M5.5 8.5h13l-1.1 10.5H6.6L5.5 8.5z" />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 4.5h12v15l-2.4-1.6-1.8 1.6-1.8-1.6-1.8 1.6-2.4-1.6z" />
      <path d="M9 9h6M9 12.5h6" />
    </>
  ),
  frame: (
    <>
      <rect x="4.5" y="5" width="15" height="14" rx="2.5" />
      <path d="M7.5 16l3.2-3.6 2.4 2.4 2-2.2 1.9 3.4" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h10" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevron: <path d="M15 6l-6 6 6 6" />,
  arrow: <path d="M20 12H5M11 6l-6 6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  caret: <path d="M6 9l6 6 6-6" />,
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className = "h-6 w-6", ...rest }: { name: IconName; className?: string } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} {...rest}>
      {paths[name]}
    </svg>
  );
}

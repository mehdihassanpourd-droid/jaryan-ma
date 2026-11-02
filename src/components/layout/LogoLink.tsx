"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { site } from "@/lib/site";

/** True when the visitor asked their system for less motion. */
export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The header logo as a real link to the home page. From any other page it navigates as usual (see `HomeScrollReset`, which starts the
 * home page at the top). On the home page itself, where a link to the current address would do nothing visible, a plain tap or Enter
 * scrolls smoothly to the top (instantly with reduced motion) and drops any #section from the address. Modified clicks (new tab,
 * new window, download) are left to the browser.
 */
export function LogoLink({ className, children }: { className?: string; children: ReactNode }) {
  const pathname = usePathname();

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (pathname !== "/" || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (window.location.hash) window.history.replaceState(window.history.state, "", `/${window.location.search}`);
    window.scrollTo({ top: 0, left: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  return (
    <Link href="/" aria-label={`${site.name}، صفحهٔ اصلی`} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

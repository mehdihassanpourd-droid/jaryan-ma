"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Arriving at the home page from another page by following a link (the logo, the tab bar, a breadcrumb...) starts it at the top, with
 * the whole hero below the sticky header. (Next.js alone scrolls the new page's first element into view, which leaves the home page
 * ~110px down, its top hidden under the header.)
 *
 * It is deliberately driven by the click, not by guessing afterwards how the page was reached: only a plain click on a link to "/"
 * (no #section, no modifier key, no new tab) marks the next arrival, and back/forward can never set that mark, so the browser's own
 * scroll restoration is never overridden, whatever order the router and the events run in. The first load and links to a #section
 * are left alone as well.
 */
export function HomeScrollReset() {
  const pathname = usePathname();
  const armed = useRef(false);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      armed.current = false;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const to = new URL(anchor.href, window.location.href);
      armed.current = to.origin === window.location.origin && to.pathname === "/" && to.hash === "" && window.location.pathname !== "/";
    };
    const onHistory = () => {
      armed.current = false;
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onHistory, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onHistory, true);
    };
  }, []);

  useEffect(() => {
    const arrived = armed.current;
    armed.current = false;
    if (arrived && pathname === "/" && !window.location.hash) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

  return null;
}

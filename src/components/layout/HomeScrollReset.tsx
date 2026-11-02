"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Arriving at the home page from another page starts it at the top, with the whole hero below the sticky header. (Next.js alone
 * scrolls the new page's first element into view, which leaves the home page ~110px down, its top hidden under the header.)
 * Left alone on purpose: the first load, back/forward (the browser restores the earlier position) and links to a #section.
 */
export function HomeScrollReset() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);
  const viaHistory = useRef(false);

  useEffect(() => {
    const onPop = () => {
      viaHistory.current = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    const popped = viaHistory.current;
    viaHistory.current = false;
    if (pathname !== "/" || from === null || from === "/" || popped || window.location.hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname]);

  return null;
}

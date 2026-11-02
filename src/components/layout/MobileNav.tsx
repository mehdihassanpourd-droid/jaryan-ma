"use client";

import { useEffect, useRef, useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { navLinks, site } from "@/lib/site";

/**
 * The phone menu: a 48px button (aria-expanded + aria-controls), a full-width list of links at least 48px tall, and the Instagram link.
 * Escape, a tap outside, or choosing a link closes it, and Escape or a tap outside hands focus back to the button.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (restoreFocus: boolean) => {
      setOpen(false);
      if (restoreFocus) button.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={root}>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? "بستن منو" : "باز کردن منو"}
        className="flex h-12 w-12 items-center justify-center text-ivory-50 hover:bg-ivory-50/15"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <nav id="mobile-menu" aria-label="منوی اصلی" className="absolute inset-x-0 top-full border-b-4 border-bark-900 bg-ivory-50 px-5 pb-6 pt-2 text-bark-900">
          <ul className="divide-y divide-bark-900/15">
            {navLinks.map((l) => (
              <li key={l.href}>
                <a href={l.href} onClick={() => setOpen(false)} className="flex min-h-12 items-center py-2 text-lg font-black">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <ButtonLink href={site.instagramUrl} target="_blank" rel="noopener noreferrer" size="lg" className="mt-4 w-full">
            <InstagramIcon />
            <span>اینستاگرام جریان ما</span>
          </ButtonLink>
        </nav>
      )}
    </div>
  );
}

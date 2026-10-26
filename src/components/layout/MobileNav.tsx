"use client";

import { useEffect, useState } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { navLinks, site } from "@/lib/site";

export function MobileNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? "بستن منو" : "باز کردن منو"}
        className="flex h-11 w-11 items-center justify-center rounded-full text-bark-700 hover:bg-sand-100"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <nav
          id="mobile-menu"
          aria-label="منوی اصلی"
          className="absolute inset-x-0 top-full border-b border-sand-200 bg-ivory-50 px-5 pb-6 pt-3 shadow-soft"
        >
          <ul className="divide-y divide-sand-200">
            {navLinks.map((l) => (
              <li key={l.href}>
                <a href={l.href} onClick={() => setOpen(false)} className="block py-3.5 text-lg text-bark-900">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <ButtonLink
            href={site.instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            size="lg"
            className="mt-4 w-full"
          >
            <InstagramIcon />
            <span>اینستاگرام جریان ما</span>
          </ButtonLink>
        </nav>
      )}
    </div>
  );
}

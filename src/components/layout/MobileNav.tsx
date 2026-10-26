"use client";

import { useState } from "react";
import { navLinks } from "@/lib/site";

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? "بستن منو" : "باز کردن منو"}
        className="flex h-10 w-10 items-center justify-center rounded-full text-bark-700 hover:bg-sand-100"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <nav id="mobile-menu" aria-label="منوی اصلی" className="absolute inset-x-0 top-full border-b border-sand-200 bg-ivory-50 px-5 py-4 shadow-soft">
          <ul className="space-y-1">
            {navLinks.map((l) => (
              <li key={l.href}>
                <a href={l.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-bark-700 hover:bg-sand-100">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

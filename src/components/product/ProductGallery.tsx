"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/format";
import type { CatalogImage } from "@/types/catalog";
import { ArtPlaceholder } from "./ArtPlaceholder";

/** Main image, previous/next controls and selectable thumbnails. Keyboard- and screen-reader friendly. */
export function ProductGallery({ images }: { images: CatalogImage[] }) {
  const [active, setActive] = useState(0);
  const current = images[active];
  if (!current) return null;

  const go = (delta: number) => setActive((i) => (i + delta + images.length) % images.length);

  return (
    <div
      className="space-y-3"
      role="group"
      aria-roledescription="گالری تصاویر"
      aria-label="گالری تصاویر محصول"
      onKeyDown={(e) => {
        // In RTL, "next" is to the left.
        if (e.key === "ArrowLeft") go(1);
        if (e.key === "ArrowRight") go(-1);
      }}
    >
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-sand-100 shadow-soft ring-1 ring-sand-200">
        <ArtPlaceholder tone={current.tone} motif={current.motif} alt={current.alt} />
        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="تصویر قبلی"
              className="absolute start-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-ivory-50/90 text-bark-900 shadow-soft hover:bg-ivory-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="تصویر بعدی"
              className="absolute end-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-ivory-50/90 text-bark-900 shadow-soft hover:bg-ivory-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <p className="absolute inset-x-0 bottom-3 mx-auto w-fit rounded-full bg-ivory-50/90 px-3 py-0.5 text-xs text-bark-700" aria-live="polite">
              {formatNumber(active + 1)} از {formatNumber(images.length)}
            </p>
          </>
        )}
      </div>
      <ul className="flex gap-3" aria-label="تصاویر محصول">
        {images.map((img, i) => (
          <li key={`${img.tone}-${img.motif}-${i}`} className="w-20">
            <button
              type="button"
              onClick={() => setActive(i)}
              aria-label={`نمایش تصویر ${formatNumber(i + 1)}`}
              aria-pressed={i === active}
              className={`block aspect-square w-full overflow-hidden rounded-xl ring-2 transition ${
                i === active ? "ring-bark-700" : "opacity-70 ring-transparent hover:opacity-100"
              }`}
            >
              <ArtPlaceholder tone={img.tone} motif={img.motif} alt="" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

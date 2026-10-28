"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { formatNumber } from "@/lib/format";
import type { CatalogImage } from "@/types/catalog";
import { GalleryFrame, thumbClass } from "./GalleryFrame";
import { SampleImage } from "./SampleImage";

/** Main image, previous/next controls and selectable thumbnails for SAMPLE illustrations. Keyboard- and screen-reader friendly. */
export function ProductGallery({ images }: { images: CatalogImage[] }) {
  const [active, setActive] = useState(0);
  const current = images[active];
  if (!current) return null;

  const go = (delta: number) => setActive((i) => (i + delta + images.length) % images.length);

  return (
    <div
      className="space-y-4"
      role="group"
      aria-roledescription="گالری تصاویر"
      aria-label="گالری تصاویر محصول"
      onKeyDown={(e) => {
        // In RTL, "next" is to the left.
        if (e.key === "ArrowLeft") go(1);
        if (e.key === "ArrowRight") go(-1);
      }}
    >
      <GalleryFrame>
        <SampleImage art={current.art} alt={current.alt} priority={active === 0} />
        <div className="absolute start-4 top-4">
          <PlaceholderTag label="تصویر موقت" />
        </div>
        {images.length > 1 && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="تصویر قبلی" className="absolute start-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center bg-ivory-50/95 text-bark-900 shadow-soft hover:bg-ivory-50">
              <Icon name="chevron" className="h-5 w-5 -scale-x-100" />
            </button>
            <button type="button" onClick={() => go(1)} aria-label="تصویر بعدی" className="absolute end-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center bg-ivory-50/95 text-bark-900 shadow-soft hover:bg-ivory-50">
              <Icon name="chevron" className="h-5 w-5" />
            </button>
            <p className="absolute inset-x-0 bottom-4 mx-auto w-fit bg-ivory-50/95 px-3 py-0.5 text-xs text-bark-700" aria-live="polite">
              {formatNumber(active + 1)} از {formatNumber(images.length)}
            </p>
          </>
        )}
      </GalleryFrame>
      {images.length > 1 && (
        <ul className="flex gap-3" aria-label="تصاویر محصول">
          {images.map((img, i) => (
            <li key={`${img.art}-${i}`} className="w-[4.5rem]">
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-label={`نمایش تصویر ${formatNumber(i + 1)}`}
                aria-pressed={i === active}
                className={`${thumbClass} ${i === active ? "ring-clay-600" : "opacity-70 ring-transparent hover:opacity-100"}`}
              >
                <SampleImage art={img.art} alt={img.alt} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import type { CatalogImage } from "@/types/catalog";
import { ArtPlaceholder } from "./ArtPlaceholder";

/** Main image plus selectable thumbnails. Keyboard- and screen-reader friendly. */
export function ProductGallery({ images }: { images: CatalogImage[] }) {
  const [active, setActive] = useState(0);
  const current = images[active];
  if (!current) return null;

  return (
    <div className="space-y-3">
      <div className="aspect-[4/5] overflow-hidden rounded-2xl bg-sand-100 shadow-soft">
        <ArtPlaceholder tone={current.tone} alt={current.alt} />
      </div>
      <ul className="flex gap-3" aria-label="تصاویر محصول">
        {images.map((img, i) => (
          <li key={`${img.tone}-${i}`} className="w-20">
            <button
              type="button"
              onClick={() => setActive(i)}
              aria-label={`نمایش تصویر ${i + 1}`}
              aria-pressed={i === active}
              className={`block aspect-square w-full overflow-hidden rounded-xl ring-2 transition ${
                i === active ? "ring-bark-700" : "ring-transparent opacity-70 hover:opacity-100"
              }`}
            >
              <ArtPlaceholder tone={img.tone} alt="" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

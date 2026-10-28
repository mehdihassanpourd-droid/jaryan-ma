import type { ReactNode } from "react";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { SampleImage } from "./SampleImage";

/** The row of small facts above the title (category, unique piece, availability, sample label). */
export function ProductChips({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export const chipClass = "inline-flex min-h-8 items-center border-2 border-bark-900 px-3 text-sm font-black text-bark-900";

/** Price (or the "not announced" note) in a soft panel, large enough to read at a glance. */
export function PricePanel({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex min-h-16 flex-wrap items-center gap-x-2 border-y-2 border-bark-900 py-3 text-2xl font-black">{children}</div>;
}

/**
 * The maker, a future curated-artist slot. Sample products show a labelled placeholder (no invented person); real products show
 * nothing until the catalogue carries artist profiles.
 */
export function ArtistNote() {
  return (
    <aside aria-label="هنرمند" className="mt-8 flex items-center gap-4 border-2 border-dashed border-bark-700 bg-ivory-50 p-4">
      <div className="h-16 w-16 shrink-0 overflow-hidden">
        <SampleImage art="artist-1" alt="تصویر موقت: نمایهٔ هنرمند نمونه" />
      </div>
      <div>
        <p className="flex flex-wrap items-center gap-2 font-bold text-bark-900">
          هنرمند: ثبت نشده <PlaceholderTag label="نمونه" />
        </p>
        <p className="mt-1 text-sm leading-7 text-bark-600">معرفی هنرمندان منتخب گالری به‌زودی اینجا می‌آید.</p>
      </div>
    </aside>
  );
}

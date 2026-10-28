import type { ReactNode } from "react";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { SampleImage } from "./SampleImage";

/** The row of small facts above the title (category, unique piece, availability, sample label). */
export function ProductChips({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export const chipClass = "inline-flex min-h-8 items-center rounded-full bg-teal-100 px-3.5 text-sm font-medium text-teal-800";

/** Price (or the "not announced" note) in a soft panel, large enough to read at a glance. */
export function PricePanel({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex min-h-14 flex-wrap items-center gap-x-2 rounded-2xl bg-ivory-100 px-5 py-2.5 text-lg ring-1 ring-sand-200">{children}</div>;
}

/**
 * The maker, a future curated-artist slot. Sample products show a labelled placeholder (no invented person); real products show
 * nothing until the catalogue carries artist profiles.
 */
export function ArtistNote() {
  return (
    <aside aria-label="هنرمند" className="mt-8 flex items-center gap-4 rounded-[1.75rem] border border-dashed border-sand-400 bg-ivory-50 p-4">
      <div className="blob-c h-16 w-16 shrink-0 overflow-hidden ring-1 ring-sand-300">
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

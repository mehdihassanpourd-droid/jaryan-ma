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

export interface ProductFact {
  label: string;
  value: ReactNode;
  /** The catalogue has no such data yet: shown as a labelled placeholder, never as an invented value. */
  placeholder?: boolean;
}

/** What the gallery states about a piece, only from data the catalogue really has (never invented materials, sizes or care text). */
export function ProductFacts({ facts }: { facts: ProductFact[] }) {
  if (facts.length === 0) return null;
  return (
    <section aria-labelledby="facts-title" className="mt-10" data-testid="product-facts">
      <h2 id="facts-title" className="border-t-2 border-bark-900 pt-2 text-xl font-black text-bark-900">مشخصات و ارسال</h2>
      <dl className="mt-2 divide-y divide-bark-900/15">
        {facts.map((f) => (
          <div key={f.label} className="grid grid-cols-[6.5rem_1fr] gap-4 py-3 text-sm leading-7">
            <dt className="font-bold text-bark-600">{f.label}</dt>
            <dd className="text-bark-900">
              {f.value} {f.placeholder && <PlaceholderTag />}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Shipping is priced by the server at checkout (destination, weight, method); this is what is true of every purchasable piece. */
export const SHIPPING_FACT: ProductFact = { label: "ارسال", value: "هزینهٔ ارسال هنگام ثبت سفارش، بر اساس مقصد و وزن بسته محاسبه می‌شود." };

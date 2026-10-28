import { SampleImage } from "@/components/product/SampleImage";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icons";
import { BrushStrokes, LeafBranch, WaveTop } from "@/components/ui/Ornaments";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";

/** Storytelling: the picture in a pebble frame between two brush strokes and a leaf, and the gallery's story (sample text until the gallery writes it). */
export function StoryBand() {
  return (
    <section id="story" aria-labelledby="story-title" className="relative mt-16 scroll-mt-20 overflow-hidden bg-ivory-100 pb-14 pt-16 sm:mt-24 sm:pb-20 sm:pt-24">
      <WaveTop />
      <Container className="relative grid grid-cols-[1.15fr_0.85fr] items-center gap-4 sm:gap-10 lg:gap-16">
        <div>
          <p className="text-sm font-medium text-clay-700">داستان جریان ما</p>
          <h2 id="story-title" className="mt-1 text-balance text-[1.9rem] font-black leading-snug text-bark-900 sm:text-5xl">
            هر اثر، یک داستان است
          </h2>
          <p className="mt-3 max-w-md text-[0.95rem] leading-8 text-bark-700 sm:text-base sm:leading-9">با هر اثر، داستانی از دست‌های خلاق ایرانی به خانه‌های شما می‌رسد.</p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs leading-6 text-bark-600 sm:text-sm">
            <PlaceholderTag label="متن نمونه" />
            متن نهایی داستان را گالری می‌نویسد.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2 text-sm font-medium text-bark-900">
            {["دست‌ساز", "ایرانی", "در جریان"].map((t) => (
              <li key={t} className="rounded-full border border-bark-900/25 bg-ivory-50 px-3.5 py-1">
                {t}
              </li>
            ))}
          </ul>
          <a href="#contact" className="mt-4 inline-flex min-h-11 items-center gap-2 border-b border-bark-900 pb-0.5 font-medium text-bark-900 hover:text-clay-700">
            ارتباط با گالری
            <Icon name="arrow" className="h-4 w-4" />
          </a>
        </div>
        <div className="relative">
          <BrushStrokes className="pointer-events-none absolute -bottom-5 -end-7 h-20 w-40 opacity-95 sm:-bottom-8 sm:-end-14 sm:h-32 sm:w-72" />
          <LeafBranch className="absolute -start-3 -top-8 z-10 h-24 w-20 text-teal-500 sm:h-32 sm:w-24" />
          <div className="blob-a relative aspect-[4/5] overflow-hidden ring-4 ring-ivory-50">
            <SampleImage art="studio-1" alt="تصویر موقت: میز کار با قلم‌مو، رنگ و کیف پارچه‌ای" />
          </div>
          <div className="absolute bottom-3 start-2">
            <PlaceholderTag label="تصویر موقت" />
          </div>
        </div>
      </Container>
    </section>
  );
}

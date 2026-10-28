import { SampleImage } from "@/components/product/SampleImage";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icons";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";

/** The wall text: a very large heading and a few lines on one side, a tall picture on a vermilion block on the other. The text is sample until the gallery writes it. */
export function StoryBand() {
  return (
    <section id="story" aria-labelledby="story-title" className="mt-24 scroll-mt-20 overflow-x-clip border-t-4 border-bark-900 pt-4 sm:mt-40">
      <Container className="grid gap-12 sm:grid-cols-12 sm:gap-8">
        <div className="sm:col-span-6 sm:pt-10">
          <p aria-hidden="true" className="text-sm font-black text-clay-600">۰۳</p>
          <h2 id="story-title" className="mt-1 text-balance text-5xl font-black leading-[1.15] text-bark-900 sm:text-7xl">
            هر اثر، <br />
            یک داستان است
          </h2>
          <p className="mt-6 max-w-md text-lg leading-9 text-bark-700">با هر اثر، داستانی از دست‌های خلاق ایرانی به خانه‌های شما می‌رسد.</p>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm leading-6 text-bark-600">
            <PlaceholderTag label="متن نمونه" />
            متن نهایی داستان را گالری می‌نویسد.
          </p>
          <ul className="mt-8 flex flex-wrap border-y-2 border-bark-900 text-sm font-black text-bark-900">
            {["دست‌ساز", "ایرانی", "در جریان"].map((t) => (
              <li key={t} className="flex-1 border-s-2 border-bark-900 py-3 text-center first:border-s-0">
                {t}
              </li>
            ))}
          </ul>
          <a href="#contact" className="mt-6 inline-flex min-h-11 items-center gap-2 border-b-2 border-bark-900 font-bold text-bark-900 hover:text-clay-600">
            ارتباط با گالری
            <Icon name="arrow" className="h-4 w-4" />
          </a>
        </div>
        <figure className="relative isolate sm:col-span-5 sm:col-start-8">
          <div aria-hidden="true" className="absolute -bottom-5 -end-5 top-16 -z-10 w-full bg-clay-600 sm:-end-8" />
          <div className="relative aspect-[4/5] overflow-hidden bg-sand-100">
            <SampleImage art="studio-1" alt="تصویر موقت: میز کار با قلم‌مو، رنگ و کیف پارچه‌ای" />
            <div className="absolute start-3 top-3">
              <PlaceholderTag label="تصویر موقت" />
            </div>
          </div>
        </figure>
      </Container>
    </section>
  );
}

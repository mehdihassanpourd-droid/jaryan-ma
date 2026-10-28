import { SampleImage } from "@/components/product/SampleImage";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";

/** The closing statement: a full-width vermilion block, one huge sentence, and a picture that overlaps the block's edge. */
export function FeelBand() {
  return (
    <section aria-labelledby="feel-title" className="mt-24 bg-clay-600 text-ivory-50 sm:mt-40">
      <Container className="grid items-end gap-10 pb-0 pt-14 sm:grid-cols-12 sm:gap-8 sm:pt-24">
        <div className="sm:col-span-7 sm:pb-24">
          <h2 id="feel-title" className="text-balance text-6xl font-black leading-[1.12] sm:text-8xl">
            هنر، حال خوب می‌آفریند.
          </h2>
          <ButtonLink href="#featured" variant="onDark" size="lg" chevron className="mt-8">
            دیدن همه آثار
          </ButtonLink>
        </div>
        <figure className="relative -mb-10 ms-auto w-[72%] sm:col-span-4 sm:col-start-9 sm:-mb-20 sm:w-full">
          <div className="relative aspect-[4/5] overflow-hidden bg-bark-900">
            <SampleImage art="mandala-2" alt="تصویر موقت: ماندالای قلاب‌بافی روی زمینهٔ سبز تیره" />
            <div className="absolute start-3 top-3">
              <PlaceholderTag label="تصویر موقت" />
            </div>
          </div>
        </figure>
      </Container>
    </section>
  );
}

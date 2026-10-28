import { SampleImage } from "@/components/product/SampleImage";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";

/** The closing call to action: a terracotta field, a large heading and a pebble-framed picture. */
export function FeelBand() {
  return (
    <section aria-labelledby="feel-title" className="mt-16 sm:mt-24">
      <Container>
        <div className="relative grid grid-cols-[1.1fr_0.9fr] items-center gap-3 overflow-hidden rounded-[2.5rem] bg-clay-600 px-6 py-10 text-ivory-50 sm:gap-8 sm:px-12 sm:py-16">
          <div>
            <h2 id="feel-title" className="text-balance text-[2.1rem] font-black leading-[1.25] sm:text-5xl">
              هنر، حال خوب می‌آفریند.
            </h2>
            <ButtonLink href="#featured" variant="onDark" size="lg" chevron className="mt-6">
              دیدن همه آثار
            </ButtonLink>
          </div>
          <div className="relative">
            <div className="blob-c relative aspect-[4/5] overflow-hidden bg-teal-900 ring-4 ring-ivory-50/80">
              <SampleImage art="mandala-2" alt="تصویر موقت: ماندالای قلاب‌بافی روی زمینهٔ سبز تیره" />
            </div>
            <div className="absolute bottom-2 start-2">
              <PlaceholderTag label="تصویر موقت" />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

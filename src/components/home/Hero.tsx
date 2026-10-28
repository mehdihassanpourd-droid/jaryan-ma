import { SampleImage } from "@/components/product/SampleImage";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { site } from "@/lib/site";

/**
 * The opening wall of the exhibition: an ink-black field, a very large heading, and one big picture on a vermilion block that is
 * offset from it. Everything is a straight-edged rectangle. The brand's confirmed slogan is the eyebrow; the picture is a labelled
 * sample illustration until real photography exists.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="overflow-x-clip bg-bark-900 text-ivory-50">
      <Container className="pb-16 pt-8 sm:pb-28 sm:pt-16">
        <p className="flex items-center gap-3 text-sm font-bold text-ivory-100">
          <span aria-hidden="true" className="inline-block h-1 w-10 bg-clay-500" />
          {site.slogan}
        </p>
        <h1 id="hero-title" className="mt-5 text-[3.6rem] font-black leading-[1.1] sm:text-8xl lg:text-[9rem]">
          هنر <br />
          در زندگی <br />
          روزمره
        </h1>
        <div className="mt-8 grid items-end gap-10 sm:mt-12 sm:grid-cols-12 sm:gap-6">
          <div className="sm:col-span-4 sm:pb-6">
            <p className="max-w-xs text-lg leading-9 text-ivory-100">آثار دست‌ساز. برای روزهای خاص و معمولی.</p>
            <ButtonLink href="#featured" variant="light" size="lg" chevron className="mt-7">
              دیدن آثار
            </ButtonLink>
          </div>
          <figure className="relative isolate ms-auto w-[88%] sm:col-span-8 sm:col-start-5 sm:w-[78%] lg:w-[64%]">
            <div aria-hidden="true" className="absolute -bottom-5 -start-5 top-12 -z-10 w-full bg-clay-600 sm:-start-8" />
            <div className="relative aspect-[4/5] overflow-hidden bg-teal-700">
              <SampleImage art="vase-1" alt="تصویر موقت: گلدان سفالی آبی با گل‌های سفید" priority />
              <div className="absolute start-3 top-3">
                <PlaceholderTag label="تصویر موقت" />
              </div>
            </div>
            <figcaption className="mt-3 text-xs font-bold text-ivory-100">۰۱ — نمونهٔ تصویر؛ عکس واقعی جایگزین می‌شود</figcaption>
          </figure>
        </div>
      </Container>
    </section>
  );
}

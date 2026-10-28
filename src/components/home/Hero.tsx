import { SampleImage } from "@/components/product/SampleImage";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icons";
import { HeroField } from "@/components/ui/Ornaments";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { site } from "@/lib/site";

/**
 * The opening: a deep-teal organic field, a very large heading, one pill button and a big picture in a pebble frame.
 * The brand's confirmed slogan sits above the heading; the picture is a labelled sample illustration until real photography exists.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden pb-14 sm:pb-20">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-[calc(100%-3.5rem)] sm:h-[calc(100%-5rem)]">
        <HeroField className="h-full w-full" />
      </div>
      <Container className="grid grid-cols-[1.12fr_0.88fr] items-center gap-4 pb-20 pt-9 sm:gap-8 sm:pb-24 sm:pt-14 lg:pb-32 lg:pt-20">
        <div className="text-ivory-50">
          <p className="text-xs font-medium text-sand-200 sm:text-sm">{site.slogan}</p>
          <h1 id="hero-title" className="mt-3 text-[2.7rem] font-black leading-[1.18] sm:text-6xl lg:text-7xl">
            هنر <br />
            در زندگی <br />
            روزمره
          </h1>
          <p className="mt-4 max-w-sm text-[0.95rem] leading-8 text-ivory-100 sm:text-lg">آثار دست‌ساز. برای روزهای خاص و معمولی.</p>
          <ButtonLink href="#featured" variant="light" size="lg" chevron className="mt-6">
            دیدن محصولات
          </ButtonLink>
        </div>
        <div className="relative">
          <div className="blob-b relative aspect-[4/5] overflow-hidden bg-teal-700 shadow-soft ring-4 ring-ivory-50/90">
            <SampleImage art="vase-1" alt="تصویر موقت: گلدان سفالی آبی با گل‌های سفید" priority />
          </div>
          <div className="absolute bottom-3 start-3">
            <PlaceholderTag label="تصویر موقت" />
          </div>
        </div>
      </Container>
      <div className="absolute inset-x-0 bottom-14 flex translate-y-1/2 justify-center sm:bottom-20">
        <a href="#collections" aria-label="رفتن به دسته‌بندی‌ها" className="flex h-12 w-12 items-center justify-center rounded-full border border-bark-900/30 bg-ivory-50 text-bark-900 shadow-soft hover:bg-sand-100">
          <Icon name="down" className="h-5 w-5" />
        </a>
      </div>
    </section>
  );
}

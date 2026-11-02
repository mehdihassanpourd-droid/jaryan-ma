import { SampleImage } from "@/components/product/SampleImage";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { site } from "@/lib/site";

/**
 * The opening wall, kept short on a phone so the collections start within the first screen: heading and one line on one side, a
 * small picture on a cream block on the other, and two ways in (the works, the collections). Straight edges only. The brand's
 * confirmed slogan is the eyebrow; the picture is a labelled sample illustration until real photography exists.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="overflow-x-clip bg-burgundy-600 text-ivory-50">
      <Container className="pb-8 pt-5 sm:pb-20 sm:pt-12">
        <div className="grid grid-cols-[1fr_9.5rem] items-end gap-5 sm:grid-cols-12 sm:gap-8">
          <div className="sm:col-span-7">
            <p className="flex items-center gap-3 text-xs font-bold text-ivory-100 sm:text-sm">
              <span aria-hidden="true" className="inline-block h-1 w-8 bg-ivory-200 sm:w-10" />
              {site.slogan}
            </p>
            <h1 id="hero-title" className="mt-3 text-[2.6rem] font-black leading-[1.12] sm:mt-5 sm:text-8xl lg:text-[8.5rem]">
              هنر <br />
              در زندگی <br />
              روزمره
            </h1>
            <p className="mt-3 max-w-md text-sm leading-7 text-ivory-100 sm:mt-6 sm:text-xl sm:leading-9">دکوراسیون خانه و هنرهای دست‌ساز، گزینش‌شده برای زندگی امروز.</p>
          </div>
          <figure className="relative isolate me-1 sm:col-span-5 sm:col-start-8 sm:me-0">
            <div aria-hidden="true" className="absolute -bottom-2.5 -start-2.5 top-5 -z-10 w-full bg-ivory-200 sm:-bottom-5 sm:-start-6 sm:top-12" />
            <div className="relative aspect-[3/4] overflow-hidden bg-burgundy-700 sm:aspect-[4/5]">
              <SampleImage art="vase-1" alt="تصویر موقت: گلدان سفالی آبی با گل‌های سفید" priority />
              <div className="absolute bottom-1.5 start-1.5 sm:bottom-auto sm:start-3 sm:top-3">
                <PlaceholderTag label="تصویر موقت" />
              </div>
            </div>
          </figure>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:mt-10 sm:flex">
          <ButtonLink href="#featured" variant="light" size="lg" chevron className="min-h-12 !px-4 sm:!px-8">
            دیدن آثار
          </ButtonLink>
          <ButtonLink href="#collections" variant="onDark" size="lg" className="min-h-12 !px-4 sm:!px-8">
            مجموعه‌ها
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}

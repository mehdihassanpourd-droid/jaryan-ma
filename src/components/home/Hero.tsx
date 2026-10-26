import { ArtPlaceholder } from "@/components/product/ArtPlaceholder";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { site } from "@/lib/site";

const highlights = ["دست‌ساز", "هنر ایرانی", "بافته و دکور خانه"];

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden bg-ivory-100">
      <Container className="grid items-center gap-12 py-12 sm:py-20 lg:grid-cols-12 lg:gap-10 lg:py-24">
        <div className="lg:col-span-6">
          <p className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-olive-700">
            <span aria-hidden="true" className="h-px w-8 bg-olive-500" />
            گالری آثار هنری دست‌ساز ایرانی
          </p>
          <h1 id="hero-title" className="text-balance text-4xl font-extrabold leading-[1.35] text-bark-900 sm:text-6xl sm:leading-[1.3]">
            {site.slogan}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-9 text-bark-600">{site.description}</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="#featured" size="lg">
              دیدن آثار
            </ButtonLink>
            <ButtonLink href={site.instagramUrl} target="_blank" rel="noopener noreferrer" variant="secondary" size="lg">
              <InstagramIcon />
              <span>دنبال کردن در اینستاگرام</span>
            </ButtonLink>
          </div>
          <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm text-bark-700">
            {highlights.map((h) => (
              <li key={h} className="flex items-center gap-2">
                <span aria-hidden="true" className="h-1.5 w-1.5 rotate-45 bg-olive-500" />
                {h}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative lg:col-span-6">
          <div className="grid grid-cols-5 gap-3 sm:gap-4">
            <div className="relative col-span-3 row-span-2 overflow-hidden rounded-[2rem] shadow-soft ring-1 ring-sand-200">
              <div className="aspect-[3/4]">
                <ArtPlaceholder tone="sand" motif="fringe" alt="تصویر نمونه دیوارکوب بافته برای معرفی گالری" />
              </div>
              <div className="absolute bottom-3 start-3">
                <PlaceholderTag label="تصویر نمونه" />
              </div>
            </div>
            <div className="col-span-2 aspect-square overflow-hidden rounded-3xl shadow-soft ring-1 ring-sand-200">
              <ArtPlaceholder tone="olive" motif="arch" alt="تصویر نمونه ماکرومه قوسی" />
            </div>
            <div className="col-span-2 aspect-square overflow-hidden rounded-3xl shadow-soft ring-1 ring-sand-200">
              <ArtPlaceholder tone="bark" motif="detail" alt="تصویر نمونه بافت از نزدیک" />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

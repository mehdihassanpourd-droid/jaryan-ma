import { ArtPlaceholder } from "@/components/product/ArtPlaceholder";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { site } from "@/lib/site";

export function Hero() {
  return (
    <section className="overflow-hidden bg-ivory-100">
      <Container className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-2 lg:gap-16">
        <div>
          <p className="mb-4 text-sm font-medium text-olive-700">گالری هنر دست‌ساز ایرانی</p>
          <h1 className="text-4xl font-extrabold leading-tight text-bark-900 sm:text-5xl">{site.slogan}</h1>
          <p className="mt-5 max-w-lg text-lg text-bark-600">{site.description}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="#featured">دیدن آثار</ButtonLink>
            <ButtonLink href={site.instagramUrl} variant="secondary" target="_blank" rel="noopener noreferrer">
              ما را در اینستاگرام دنبال کنید
            </ButtonLink>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4" aria-hidden="false">
          <div className="aspect-[3/4] overflow-hidden rounded-3xl shadow-soft">
            <ArtPlaceholder tone="sand" alt="تصویر نمونه برای معرفی گالری" />
          </div>
          <div className="mt-10 aspect-[3/4] overflow-hidden rounded-3xl shadow-soft">
            <ArtPlaceholder tone="olive" alt="تصویر نمونه برای معرفی آثار" />
          </div>
        </div>
      </Container>
    </section>
  );
}

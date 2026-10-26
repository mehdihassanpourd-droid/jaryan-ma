import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { site } from "@/lib/site";

export function InstagramCta() {
  return (
    <section aria-labelledby="ig-title" className="py-16 sm:py-24">
      <Container className="text-center">
        <h2 id="ig-title" className="text-2xl font-bold text-bark-900 sm:text-3xl">
          جریان را در اینستاگرام دنبال کنید
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-bark-600">تازه‌ترین آثار و پشت‌صحنه‌ی ساخت آن‌ها را در صفحه‌ی ما ببینید.</p>
        <div className="mt-6">
          <ButtonLink href={site.instagramUrl} target="_blank" rel="noopener noreferrer">
            <span dir="ltr">@{site.instagramHandle}</span>
          </ButtonLink>
        </div>
      </Container>
    </section>
  );
}

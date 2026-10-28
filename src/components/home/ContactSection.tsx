import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { site } from "@/lib/site";

const channels = [
  { label: "تلفن", value: site.contact.phone, ltr: true },
  { label: "ایمیل", value: site.contact.email, ltr: true },
  { label: "نشانی", value: site.contact.address, ltr: false },
] as const;

/** Real values render normally; anything still `null` in `site.contact` shows a marked placeholder. */
export function ContactSection() {
  return (
    <section id="contact" aria-labelledby="contact-title" className="mt-16 scroll-mt-20 sm:mt-24">
      <Container>
        <SectionHeader id="contact-title" title="با ما در ارتباط باشید" />
        <p className="-mt-2 mb-6 text-bark-700">در حال حاضر مطمئن‌ترین راه ارتباط با گالری، صفحه اینستاگرام است.</p>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-[2rem] bg-teal-900 p-8 text-ivory-50 sm:p-10">
            <InstagramIcon className="h-8 w-8 text-sand-200" />
            <p className="mt-5 text-2xl font-black">
              <span dir="ltr">@{site.instagramHandle}</span>
            </p>
            <p className="mt-3 leading-8 text-sand-100">آثار جدید، پشت‌صحنه ساخت و پیام مستقیم به گالری در اینستاگرام.</p>
            <ButtonLink href={site.instagramUrl} target="_blank" rel="noopener noreferrer" variant="light" size="lg" chevron className="mt-8">
              رفتن به اینستاگرام
            </ButtonLink>
          </div>

          <dl className="divide-y divide-sand-200 rounded-[2rem] border border-sand-200 bg-ivory-50 px-6 sm:px-8">
            {channels.map((c) => (
              <div key={c.label} className="flex items-center justify-between gap-4 py-5">
                <dt className="text-bark-600">{c.label}</dt>
                <dd className="text-bark-900">
                  {c.value ? (
                    <span dir={c.ltr ? "ltr" : undefined}>{c.value}</span>
                  ) : (
                    <span className="inline-flex items-center gap-2 text-sm text-bark-600">
                      ثبت نشده <PlaceholderTag label="به‌زودی" />
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Container>
    </section>
  );
}

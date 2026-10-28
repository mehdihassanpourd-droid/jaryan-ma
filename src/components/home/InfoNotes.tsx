import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icons";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { site } from "@/lib/site";

// Policies, reviews and FAQ are NOT real yet. They are shown as clearly marked placeholders and make no promises
// (no shipping times, guarantees or ratings).
const pending = [
  { title: "ارسال و بسته‌بندی", text: "شرایط ارسال، زمان تحویل و نحوه بسته‌بندی پس از تعیین توسط گالری اینجا اعلام می‌شود." },
  { title: "بازگشت و نگهداری اثر", text: "سیاست بازگشت و راهنمای نگهداری آثار پس از تأیید گالری ثبت می‌شود." },
  { title: "نظر مشتریان", text: "نظرات واقعی خریداران پس از شروع فروش و با اجازه آن‌ها نمایش داده می‌شود." },
  { title: "پرسش‌های متداول", text: "پاسخ پرسش‌های رایج درباره سفارش و آثار در این بخش قرار می‌گیرد." },
];

/** What the gallery knows (plain text) and what is still to come (labelled, collapsed): honest, compact, no promises. */
export function InfoNotes() {
  return (
    <section id="trust" aria-labelledby="trust-title" className="mt-16 scroll-mt-20 sm:mt-24">
      <Container className="max-w-3xl">
        <SectionHeader id="trust-title" title="اطلاعات خرید" />
        <p className="mb-5 leading-8 text-bark-700">
          {site.name} گالری و فروشگاه آثار هنری دست‌ساز ایرانی است. تازه‌ترین آثار را در{" "}
          <a href={site.instagramUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-teal-700 underline underline-offset-4" dir="ltr">
            @{site.instagramHandle}
          </a>{" "}
          ببینید.
        </p>
        <div className="divide-y divide-sand-200 overflow-hidden border border-sand-200 bg-ivory-50">
          {pending.map((item) => (
            <details key={item.title} className="group px-5">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-3 font-bold text-bark-900 [&::-webkit-details-marker]:hidden">
                <span>{item.title}</span>
                <span className="flex items-center gap-2">
                  <PlaceholderTag />
                  <Icon name="caret" className="h-5 w-5 transition-transform group-open:rotate-180" />
                </span>
              </summary>
              <p className="pb-4 text-sm leading-7 text-bark-600">{item.text}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}

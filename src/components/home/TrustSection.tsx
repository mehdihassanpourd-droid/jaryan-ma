import { Container } from "@/components/ui/Container";
import { InfoPanel } from "@/components/ui/InfoPanel";
import { PlaceholderPanel } from "@/components/ui/PlaceholderPanel";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { site } from "@/lib/site";

// Policies, reviews and FAQ are NOT real yet. They are shown as clearly marked
// placeholders and make no promises (no shipping times, guarantees or ratings).
const pending = [
  { title: "ارسال و بسته‌بندی", text: "شرایط ارسال، زمان تحویل و نحوه بسته‌بندی پس از تعیین توسط گالری اینجا اعلام می‌شود." },
  { title: "بازگشت و نگهداری اثر", text: "سیاست بازگشت و راهنمای نگهداری آثار بافته پس از تأیید گالری ثبت می‌شود." },
  { title: "نظر مشتریان", text: "نظرات واقعی خریداران پس از شروع فروش و با اجازه آن‌ها نمایش داده می‌شود." },
  { title: "پرسش‌های متداول", text: "پاسخ پرسش‌های رایج درباره سفارش و آثار در این بخش قرار می‌گیرد." },
];

export function TrustSection() {
  return (
    <section id="trust" aria-labelledby="trust-title" className="scroll-mt-24 py-16 sm:py-24">
      <Container>
        <SectionHeading
          id="trust-title"
          eyebrow="اطمینان و شفافیت"
          title="آنچه می‌دانیم و آنچه هنوز تکمیل نشده"
          description="کارت‌های ساده اطلاعات واقعی گالری‌اند. کارت‌های خط‌چین محتوای نمونه‌اند و هیچ تعهدی ایجاد نمی‌کنند."
        />
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <li>
            <InfoPanel title="آثار دست‌ساز ایرانی" className="h-full">
              {site.name} گالری و فروشگاه آثار هنری دست‌ساز ایرانی است.
            </InfoPanel>
          </li>
          <li>
            <InfoPanel title="حضور در اینستاگرام" className="h-full">
              تازه‌ترین آثار را در{" "}
              <a href={site.instagramUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-olive-700 underline underline-offset-4" dir="ltr">
                @{site.instagramHandle}
              </a>{" "}
              ببینید.
            </InfoPanel>
          </li>
          {pending.map((item) => (
            <li key={item.title}>
              <PlaceholderPanel title={item.title} className="h-full">
                {item.text}
              </PlaceholderPanel>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";

const values = [
  { title: "دست‌ساز", text: "هر اثر با دست و با زمان ساخته می‌شود، نه در خط تولید." },
  { title: "ایرانی", text: "حمایت از هنر و هنرمند ایرانی و ریشه‌های بومی آن." },
  { title: "در جریان", text: "هنر زنده است و هر روز در حال حرکت؛ ما آن را همراهی می‌کنیم." },
];

export function BrandStory() {
  return (
    <section id="story" aria-labelledby="story-title" className="scroll-mt-20 bg-sand-100 py-16 sm:py-24">
      <Container>
        <SectionHeading
          id="story-title"
          eyebrow="درباره ما"
          title="جریان ما"
          description="متن معرفی نهایی گالری پس از دریافت از مجموعه جایگزین می‌شود؛ ارزش‌های زیر نمونه‌اند."
        />
        <ul className="grid gap-6 sm:grid-cols-3">
          {values.map((v) => (
            <li key={v.title} className="rounded-2xl bg-ivory-50 p-6 shadow-soft">
              <h3 className="text-lg font-bold text-bark-900">{v.title}</h3>
              <p className="mt-2 text-bark-600">{v.text}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

import { ArtPlaceholder } from "@/components/product/ArtPlaceholder";
import { Container } from "@/components/ui/Container";
import { PlaceholderPanel } from "@/components/ui/PlaceholderPanel";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { site } from "@/lib/site";

const values = [
  { title: "دست‌ساز", text: "هر اثر با دست و با زمان ساخته می‌شود." },
  { title: "ایرانی", text: "حمایت از هنر و هنرمند ایرانی و ریشه‌های بومی آن." },
  { title: "در جریان", text: "هنر زنده است و در زندگی روزمره جریان دارد." },
];

export function BrandStory() {
  return (
    <section id="story" aria-labelledby="story-title" className="scroll-mt-24 bg-sand-100 py-16 sm:py-24">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <div className="relative mx-auto aspect-[4/5] max-w-sm overflow-hidden rounded-[2rem] shadow-soft ring-1 ring-sand-300">
              <ArtPlaceholder tone="ivory" motif="arch" alt="تصویر نمونه برای بخش داستان گالری" />
              <div className="absolute bottom-3 start-3">
                <PlaceholderTag label="تصویر نمونه" />
              </div>
            </div>
          </div>
          <div className="lg:col-span-7">
            <SectionHeading
              id="story-title"
              eyebrow="داستان ما"
              title={`${site.name}؛ ${site.slogan}`}
              description="گالری جریان ما آثار هنری دست‌ساز ایرانی را معرفی و عرضه می‌کند."
            />
            <PlaceholderPanel title="متن معرفی گالری" tagLabel="متن نمونه" className="mb-6">
              <p>
                این بخش برای داستان واقعی گالری رزرو شده است: چگونه شروع شد، چه کسانی آثار را می‌سازند و چه چیزی در کار شما
                اهمیت دارد. متن نهایی را مجموعه ارائه می‌دهد و جایگزین این پاراگراف می‌شود.
              </p>
            </PlaceholderPanel>
            <ul className="grid gap-4 sm:grid-cols-3">
              {values.map((v) => (
                <li key={v.title} className="rounded-2xl border border-dashed border-sand-400 bg-ivory-50/70 p-5">
                  <h3 className="font-bold text-bark-900">{v.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-bark-600">{v.text}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-bark-600">ارزش‌های بالا پیشنهاد اولیه‌اند و پس از تأیید گالری نهایی می‌شوند.</p>
          </div>
        </div>
      </Container>
    </section>
  );
}

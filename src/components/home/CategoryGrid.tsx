import { ArtPlaceholder } from "@/components/product/ArtPlaceholder";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { demoCategories } from "@/data/demo-catalog";

export function CategoryGrid() {
  return (
    <section id="collections" aria-labelledby="collections-title" className="scroll-mt-20 py-16 sm:py-24">
      <Container>
        <SectionHeading
          id="collections-title"
          eyebrow="مجموعه‌ها"
          title="از کجا شروع کنیم؟"
          description="دسته‌بندی‌های نمونه؛ فهرست نهایی پس از تأیید مجموعه مشخص می‌شود."
        />
        <ul className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
          {demoCategories.map((c) => (
            <li key={c.slug}>
              <a href="#featured" className="group block">
                <div className="aspect-square overflow-hidden rounded-2xl shadow-soft">
                  <div className="h-full w-full transition-transform duration-500 group-hover:scale-105">
                    <ArtPlaceholder tone={c.tone} alt={`تصویر نمونه دسته ${c.name}`} />
                  </div>
                </div>
                <h3 className="mt-3 font-semibold text-bark-900">{c.name}</h3>
                <p className="text-sm text-bark-500">{c.blurb}</p>
              </a>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

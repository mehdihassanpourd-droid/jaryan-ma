import Link from "next/link";
import { ArtPlaceholder } from "@/components/product/ArtPlaceholder";
import { Container } from "@/components/ui/Container";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { demoCategories, demoProducts } from "@/data/demo-catalog";
import { countByCategory } from "@/lib/catalog";
import { formatNumber } from "@/lib/format";
import { categoryPath } from "@/seo/urls";

export function CategoryGrid() {
  return (
    <section id="collections" aria-labelledby="collections-title" className="scroll-mt-24 py-16 sm:py-24">
      <Container>
        <SectionHeading
          id="collections-title"
          eyebrow="مجموعه‌ها"
          title="از دیوار تا میز؛ بافته‌هایی برای خانه"
          description="دسته‌بندی‌های پیشنهادی برای آثار بافته و دکور خانه. فهرست نهایی را گالری تأیید می‌کند."
          aside={<PlaceholderTag label="دسته‌بندی نمونه" />}
        />
        <ul className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
          {demoCategories.map((c) => (
            <li key={c.slug}>
              <Link href={categoryPath(c.slug)} className="group block rounded-2xl">
                <div className="aspect-[4/5] overflow-hidden rounded-2xl shadow-soft ring-1 ring-sand-200">
                  <div className="h-full w-full transition-transform duration-500 group-hover:scale-105">
                    <ArtPlaceholder tone={c.tone} motif={c.motif} alt={`تصویر نمونه دسته ${c.name}`} />
                  </div>
                </div>
                <h3 className="mt-4 text-lg font-bold text-bark-900">{c.name}</h3>
                <p className="text-sm text-bark-600">{c.blurb}</p>
                <p className="mt-1 text-xs text-olive-700">{formatNumber(countByCategory(demoProducts, c.slug))} اثر نمونه</p>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

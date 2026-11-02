import { Container } from "@/components/ui/Container";
import { focusAreas } from "@/lib/site";

/**
 * What Jaryan Ma curates, as a typographic index (no pictures, no invented claims): the brand's own description of itself.
 * It says the gallery is broader than the first collections, which come from the catalogue and grow on their own.
 */
export function FocusAreas() {
  return (
    <section id="scope" aria-labelledby="scope-title" className="mt-16 scroll-mt-20 bg-ivory-200 pb-12 pt-4 sm:mt-32 sm:pb-24">
      <Container>
        <div className="border-t-4 border-bark-900 pt-3">
          <p aria-hidden="true" className="text-sm font-black text-burgundy-600">۰۳</p>
          <div className="mt-1 grid gap-6 sm:grid-cols-12 sm:gap-6">
            <h2 id="scope-title" className="text-balance text-3xl font-black leading-[1.3] text-bark-900 sm:col-span-6 sm:text-6xl">
              دکوراسیون خانه و هنرهای دست‌ساز، گزینش‌شده
            </h2>
            <ol className="sm:col-span-5 sm:col-start-8">
              {focusAreas.map((area, i) => (
                <li key={area} className="flex items-baseline gap-4 border-b border-bark-900/25 py-3 first:border-t-2 first:border-bark-900 sm:py-4">
                  <span aria-hidden="true" className="w-7 shrink-0 text-sm font-black text-burgundy-600">{new Intl.NumberFormat("fa-IR", { minimumIntegerDigits: 2 }).format(i + 1)}</span>
                  <span className="text-xl font-black text-bark-900 sm:text-2xl">{area}</span>
                </li>
              ))}
            </ol>
          </div>
          <p className="mt-6 max-w-xl text-sm leading-7 text-bark-600">مجموعه‌ها از روی آثار منتشرشده ساخته می‌شوند و با افزودن اثر تازه گسترش می‌یابند.</p>
        </div>
      </Container>
    </section>
  );
}

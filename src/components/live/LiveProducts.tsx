"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Price } from "@/components/ui/Price";
import { ALL_CATEGORIES } from "@/lib/catalog";
import { formatNumber } from "@/lib/format";
import { liveProductHref, safeImageUrl } from "@/lib/live-catalog";
import { useLiveCatalog, useLoad } from "./useLiveCatalog";

const AVAILABILITY_LABEL = { in_stock: "موجود", sold_out: "ناموجود", made_to_order: "ساخت پس از سفارش" } as const;

/** Category chips plus the grid of PUBLISHED products, read from the live catalogue in the browser. */
export function LiveProducts() {
  const catalog = useLiveCatalog();
  const home = useLoad(catalog ? () => catalog.loadHome() : null, "home");
  const [active, setActive] = useState<string>(ALL_CATEGORIES);

  if (home.state === "loading") return <p role="status" className="text-bark-600">در حال دریافت محصولات…</p>;
  if (home.state === "error") return <p role="alert" className="rounded-2xl border border-sand-300 bg-ivory-50 p-5 text-bark-700">در حال حاضر دریافت محصولات ممکن نیست. چند دقیقهٔ دیگر دوباره سر بزنید.</p>;

  const { categories, cards } = home.value;
  if (cards.length === 0) return <p role="status" className="rounded-2xl border border-sand-300 bg-ivory-50 p-5 text-bark-700">هنوز محصولی منتشر نشده است.</p>;

  const chips = [{ slug: ALL_CATEGORIES, name: "همه" }, ...categories];
  const visible = active === ALL_CATEGORIES ? cards : cards.filter((c) => c.categorySlugs.includes(active));

  return (
    <div data-testid="live-products">
      {categories.length > 1 && (
        <ul className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" aria-label="فیلتر دسته‌بندی">
          {chips.map((c) => (
            <li key={c.slug} className="shrink-0">
              <button
                type="button"
                onClick={() => setActive(c.slug)}
                aria-pressed={active === c.slug}
                className={`rounded-full border px-4 py-2 text-sm transition-colors ${active === c.slug ? "border-bark-700 bg-bark-700 text-ivory-50" : "border-sand-300 bg-ivory-50 text-bark-700 hover:border-bark-500"}`}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-sm text-bark-600" aria-live="polite">{formatNumber(visible.length)} اثر</p>
      <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-3">
        {visible.map((p) => {
          const cover = p.cover ? safeImageUrl(p.cover.url) : null;
          const price = p.priceFromToman ?? p.priceToman;
          return (
            <li key={p.slug}>
              <article className="group flex h-full flex-col">
                <Link href={liveProductHref(p.slug)} className="flex h-full flex-col" aria-label={p.name}>
                  <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-sand-100 shadow-soft ring-1 ring-sand-200 transition-shadow duration-300 group-hover:shadow-lg">
                    {cover && (
                      // eslint-disable-next-line @next/next/no-img-element -- static export: no image optimiser
                      <img src={cover} alt={p.cover?.alt || p.name} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    )}
                    <div className="absolute start-3 top-3 flex flex-wrap gap-2">
                      {p.fulfillment === "unique" && <Badge tone="olive">اثر یگانه</Badge>}
                      {p.availability !== "in_stock" && <Badge tone="neutral">{AVAILABILITY_LABEL[p.availability]}</Badge>}
                    </div>
                  </div>
                  <div className="mt-4 space-y-1">
                    <h3 className="font-semibold leading-7 text-bark-900">{p.name}</h3>
                    <div className="flex items-center gap-1 pt-1">
                      {p.priceFromToman !== null && p.priceFromToman !== p.priceToman && <span className="text-sm text-bark-600">از</span>}
                      <Price amount={price} />
                    </div>
                  </div>
                </Link>
              </article>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

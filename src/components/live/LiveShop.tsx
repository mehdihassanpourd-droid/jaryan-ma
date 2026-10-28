"use client";

import { useState } from "react";
import { CategoryMosaic, CategoryTile } from "@/components/home/CategoryTile";
import { ProductTile } from "@/components/product/ProductTile";
import { WALL_SLOTS } from "@/components/product/wall";
import { Badge } from "@/components/ui/Badge";
import { Container } from "@/components/ui/Container";
import { Price } from "@/components/ui/Price";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ALL_CATEGORIES } from "@/lib/catalog";
import { formatNumber } from "@/lib/format";
import { liveProductHref, safeImageUrl } from "@/lib/live-catalog";
import { useLiveCatalog, useLoad } from "./useLiveCatalog";

const AVAILABILITY_LABEL = { in_stock: "موجود", sold_out: "ناموجود", made_to_order: "ساخت پس از سفارش" } as const;

/**
 * The home page's categories and product grid for a LIVE catalogue: read in the visitor's browser from the published snapshots, so
 * publishing in the admin needs no new deployment. A category tile filters the grid; the covers are the products' own photographs.
 */
export function LiveShop() {
  const catalog = useLiveCatalog();
  const home = useLoad(catalog ? () => catalog.loadHome() : null, "home");
  const [active, setActive] = useState<string>(ALL_CATEGORIES);

  const frame = (children: React.ReactNode) => (
    <section id="featured" aria-labelledby="featured-title" className="scroll-mt-20 pt-14 sm:pt-20">
      <Container>
        <SectionHeader id="featured-title" title="آثار" index="۰۲" />
        {children}
      </Container>
    </section>
  );
  if (home.state === "loading") return frame(<p role="status" className="text-bark-600">در حال دریافت محصولات…</p>);
  if (home.state === "error") return frame(<p role="alert" className=" border border-sand-300 bg-ivory-50 p-5 text-bark-700">در حال حاضر دریافت محصولات ممکن نیست. چند دقیقهٔ دیگر دوباره سر بزنید.</p>);

  const { categories, cards } = home.value;
  if (cards.length === 0) return frame(<p role="status" className=" border border-sand-300 bg-ivory-50 p-5 text-bark-700">هنوز محصولی منتشر نشده است.</p>);

  const chips = [{ slug: ALL_CATEGORIES, name: "همه" }, ...categories];
  const visible = active === ALL_CATEGORIES ? cards : cards.filter((c) => c.categorySlugs.includes(active));
  const choose = (slug: string, scroll = false) => {
    setActive(slug);
    if (scroll) document.getElementById("featured")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };

  return (
    <>
      {categories.length > 0 && (
        <section id="collections" aria-labelledby="collections-title" className="scroll-mt-20 pt-14 sm:pt-20">
          <Container>
            <SectionHeader id="collections-title" title="دسته‌بندی‌ها" index="۰۱" href="#featured" />
            <CategoryMosaic>
              {categories.map((c, i) => {
                const cover = cards.find((card) => card.categorySlugs.includes(c.slug))?.cover;
                const url = cover ? safeImageUrl(cover.url) : null;
                return (
                  <li key={c.slug}>
                    <CategoryTile
                      index={i}
                      name={c.name}
                      count={c.count}
                      active={active === c.slug}
                      onSelect={() => choose(active === c.slug ? ALL_CATEGORIES : c.slug, true)}
                      media={
                        url ? (
                          // eslint-disable-next-line @next/next/no-img-element -- static export: no image optimiser
                          <img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        ) : (
                          <span className="block h-full w-full bg-teal-100" />
                        )
                      }
                    />
                  </li>
                );
              })}
            </CategoryMosaic>
          </Container>
        </section>
      )}
      {frame(
        <div data-testid="live-products">
          {categories.length > 1 && (
            <ul className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" aria-label="فیلتر دسته‌بندی">
              {chips.map((c) => (
                <li key={c.slug} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => choose(c.slug)}
                    aria-pressed={active === c.slug}
                    className={`min-h-11 border px-4 text-sm font-medium transition-colors ${active === c.slug ? "border-bark-900 bg-bark-900 text-ivory-50" : "border-bark-900/25 bg-ivory-50 text-bark-900 hover:border-bark-900"}`}
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-sm text-bark-600" aria-live="polite">{formatNumber(visible.length)} اثر</p>
          <ul className="mt-8 grid grid-cols-12 items-end gap-x-4 gap-y-14 sm:gap-y-20">
            {visible.map((p, i) => {
              const cover = p.cover ? safeImageUrl(p.cover.url) : null;
              const price = p.priceFromToman ?? p.priceToman;
              return (
                <li key={p.slug} className={WALL_SLOTS[i % WALL_SLOTS.length]}>
                  <ProductTile
                    href={liveProductHref(p.slug)}
                    name={p.name}
                    unique={p.fulfillment === "unique"}
                    extra={p.availability !== "in_stock" ? <Badge tone="neutral">{AVAILABILITY_LABEL[p.availability]}</Badge> : null}
                    media={
                      cover ? (
                        // eslint-disable-next-line @next/next/no-img-element -- static export: no image optimiser
                        <img src={cover} alt={p.cover?.alt || p.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      ) : null
                    }
                    price={
                      <span className="flex items-center gap-1">
                        {p.priceFromToman !== null && p.priceFromToman !== p.priceToman && <span className="text-sm text-bark-600">از</span>}
                        <Price amount={price} />
                      </span>
                    }
                  />
                </li>
              );
            })}
          </ul>
        </div>,
      )}
    </>
  );
}

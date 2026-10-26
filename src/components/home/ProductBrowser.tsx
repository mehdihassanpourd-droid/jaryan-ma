"use client";

import { useState } from "react";
import { ProductCard } from "@/components/product/ProductCard";
import { ALL_CATEGORIES, filterByCategory } from "@/lib/catalog";
import { formatNumber } from "@/lib/format";
import type { CatalogCategory, CatalogProduct } from "@/types/catalog";

interface ProductBrowserProps {
  products: CatalogProduct[];
  categories: CatalogCategory[];
}

/** Category chips plus the filtered product grid (client-side, static-export friendly). */
export function ProductBrowser({ products, categories }: ProductBrowserProps) {
  const [active, setActive] = useState<string>(ALL_CATEGORIES);
  const visible = filterByCategory(products, active);
  const chips = [{ slug: ALL_CATEGORIES, name: "همه" }, ...categories];

  return (
    <div>
      <ul className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" aria-label="فیلتر دسته‌بندی">
        {chips.map((c) => (
          <li key={c.slug} className="shrink-0">
            <button
              type="button"
              onClick={() => setActive(c.slug)}
              aria-pressed={active === c.slug}
              className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                active === c.slug
                  ? "border-bark-700 bg-bark-700 text-ivory-50"
                  : "border-sand-300 bg-ivory-50 text-bark-700 hover:border-bark-500"
              }`}
            >
              {c.name}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-bark-600" aria-live="polite">
        {formatNumber(visible.length)} اثر نمونه
      </p>
      <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-3">
        {visible.map((p) => (
          <li key={p.slug}>
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
    </div>
  );
}

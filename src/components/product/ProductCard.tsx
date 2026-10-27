import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Price } from "@/components/ui/Price";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { getCategory } from "@/data/demo-catalog";
import { productPath } from "@/seo/urls";
import type { CatalogProduct } from "@/types/catalog";
import { ArtPlaceholder } from "./ArtPlaceholder";

export function ProductCard({ product }: { product: CatalogProduct }) {
  const cover = product.images[0];
  const category = getCategory(product.categorySlug);

  return (
    <article className="group flex h-full flex-col">
      <Link href={productPath(product.slug)} className="flex h-full flex-col" aria-label={product.title}>
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-sand-100 shadow-soft ring-1 ring-sand-200 transition-shadow duration-300 group-hover:shadow-lg">
          {cover && (
            <div className="h-full w-full transition-transform duration-500 group-hover:scale-105">
              <ArtPlaceholder tone={cover.tone} motif={cover.motif} alt={cover.alt} />
            </div>
          )}
          <div className="absolute start-3 top-3 flex flex-wrap gap-2">
            {product.isDemo && <PlaceholderTag />}
            {product.isUnique && <Badge tone="olive">اثر یگانه</Badge>}
          </div>
        </div>
        <div className="mt-4 space-y-1">
          {category && <p className="text-xs text-olive-700">{category.name}</p>}
          <h3 className="font-semibold leading-7 text-bark-900">{product.title}</h3>
          <div className="pt-1">
            <Price amount={product.priceToman} />
          </div>
        </div>
      </Link>
    </article>
  );
}

import { Badge } from "@/components/ui/Badge";
import { Price } from "@/components/ui/Price";
import { getCategory } from "@/data/demo-catalog";
import type { CatalogProduct } from "@/types/catalog";
import { ArtPlaceholder } from "./ArtPlaceholder";

export function ProductCard({ product }: { product: CatalogProduct }) {
  const cover = product.images[0];
  const category = getCategory(product.categorySlug);

  return (
    <article className="group flex flex-col">
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-sand-100 shadow-soft">
        {cover && (
          <div className="h-full w-full transition-transform duration-500 group-hover:scale-105">
            <ArtPlaceholder tone={cover.tone} alt={cover.alt} />
          </div>
        )}
        <div className="absolute start-3 top-3 flex gap-2">
          {product.isDemo && <Badge tone="demo">نمونه</Badge>}
          {product.isUnique && <Badge tone="olive">اثر یگانه</Badge>}
        </div>
      </div>
      <div className="mt-4 space-y-1">
        {category && <p className="text-xs text-olive-700">{category.name}</p>}
        <h3 className="font-semibold text-bark-900">{product.title}</h3>
        <p className="text-xs text-bark-500">{product.vendorName}</p>
        <div className="pt-1">
          <Price amount={product.priceToman} />
        </div>
      </div>
    </article>
  );
}

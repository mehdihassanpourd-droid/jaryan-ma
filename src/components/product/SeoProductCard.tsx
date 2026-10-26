import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { Price } from "@/components/ui/Price";
import type { ProductSeo } from "@/seo/catalog-seo";
import { lowestPrice } from "@/seo/catalog-seo";
import type { SeoProduct } from "@/seo/types";
import { ArtPlaceholder } from "./ArtPlaceholder";

/** Same look as the home page's ProductCard, but a real link to the product page, for any catalogue item. */
export function SeoProductCard({ product, seo }: { product: SeoProduct; seo: ProductSeo }) {
  const cover = seo.images[0];
  const price = lowestPrice(product);
  return (
    <article className="group flex h-full flex-col">
      <Link href={seo.path} className="flex h-full flex-col" aria-label={product.name}>
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-sand-100 shadow-soft ring-1 ring-sand-200 transition-shadow duration-300 group-hover:shadow-lg">
          {cover?.placeholder ? (
            <div className="h-full w-full transition-transform duration-500 group-hover:scale-105">
              <ArtPlaceholder tone={cover.placeholder.tone} motif={cover.placeholder.motif} alt={cover.alt} />
            </div>
          ) : cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- static export: no image optimiser
            <img src={cover.url} alt={cover.alt} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          ) : null}
          <div className="absolute start-3 top-3 flex flex-wrap gap-2">
            {product.isDemo && <PlaceholderTag />}
            {product.fulfillment === "unique" && <Badge tone="olive">اثر یگانه</Badge>}
          </div>
        </div>
        <div className="mt-4 space-y-1">
          {product.category && <p className="text-xs text-olive-700">{product.category.name}</p>}
          <h3 className="font-semibold leading-7 text-bark-900">{product.name}</h3>
          <div className="flex items-center gap-1 pt-1">
            {price?.from && <span className="text-sm text-bark-600">از</span>}
            <Price amount={price?.amount ?? null} />
          </div>
        </div>
      </Link>
    </article>
  );
}

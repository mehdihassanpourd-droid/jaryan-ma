import { Price } from "@/components/ui/Price";
import type { ProductSeo } from "@/seo/catalog-seo";
import { lowestPrice } from "@/seo/catalog-seo";
import type { SeoProduct } from "@/seo/types";
import { ProductTile } from "./ProductTile";
import { SampleImage } from "./SampleImage";

/** A real link to the product page, for any catalogue item (sample illustration or real photograph). */
export function SeoProductCard({ product, seo }: { product: SeoProduct; seo: ProductSeo }) {
  const cover = seo.images[0];
  const price = lowestPrice(product);
  return (
    <ProductTile
      href={seo.path}
      name={product.name}
      categoryName={product.category?.name}
      sample={product.isDemo}
      unique={product.fulfillment === "unique"}
      media={
        cover?.placeholder ? (
          <SampleImage art={cover.placeholder.art} alt={cover.alt} />
        ) : cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- static export: no image optimiser
          <img src={cover.url} alt={cover.alt} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : null
      }
      price={
        <span className="flex items-center gap-1">
          {price?.from && <span className="text-sm text-bark-600">از</span>}
          <Price amount={price?.amount ?? null} />
        </span>
      }
    />
  );
}

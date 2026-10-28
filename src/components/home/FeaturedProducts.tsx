import { SampleImage } from "@/components/product/SampleImage";
import { ProductTile } from "@/components/product/ProductTile";
import { Container } from "@/components/ui/Container";
import { Price } from "@/components/ui/Price";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { featuredProducts, getCategory } from "@/data/demo-catalog";
import { productPath } from "@/seo/urls";

/** Sample products. With a live catalogue, `LiveShop` replaces this section. */
export function FeaturedProducts() {
  return (
    <section id="featured" aria-labelledby="featured-title" className="scroll-mt-20 pt-14 sm:pt-20">
      <Container>
        <SectionHeader id="featured-title" title="منتخب‌های امروز" />
        <p className="-mt-2 mb-6 text-sm text-bark-600">این محصولات نمونه‌اند تا ظاهر فروشگاه دیده شود؛ تصویر، نام و قیمت واقعی پس از دریافت از گالری جایگزین می‌شود.</p>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 lg:grid-cols-3 [&>li:nth-child(even)]:mt-6 lg:[&>li:nth-child(even)]:mt-0 lg:[&>li:nth-child(3n+2)]:mt-8">
          {featuredProducts.map((p) => {
            const cover = p.images[0];
            return (
              <li key={p.slug}>
                <ProductTile
                  href={productPath(p.slug)}
                  name={p.title}
                  categoryName={getCategory(p.categorySlug)?.name}
                  sample={p.isDemo}
                  unique={p.isUnique}
                  media={cover ? <SampleImage art={cover.art} alt={cover.alt} /> : null}
                  price={<Price amount={p.priceToman} />}
                />
              </li>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}

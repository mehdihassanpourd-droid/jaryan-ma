import { SampleImage } from "@/components/product/SampleImage";
import { ProductTile } from "@/components/product/ProductTile";
import { Container } from "@/components/ui/Container";
import { Price } from "@/components/ui/Price";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { featuredProducts, getCategory } from "@/data/demo-catalog";
import { productPath } from "@/seo/urls";
import { PRODUCT_GRID } from "@/components/product/wall";

/** Sample products on one consistent grid (see `PRODUCT_GRID`). With a live catalogue, `LiveShop` replaces this section. */
export function FeaturedProducts() {
  return (
    <section id="featured" aria-labelledby="featured-title" className="scroll-mt-20 pt-20 sm:pt-32">
      <Container>
        <SectionHeader id="featured-title" title="منتخب‌های امروز" index="۰۲" />
        <p className="-mt-4 mb-10 max-w-xl text-sm leading-7 text-bark-600">این آثار نمونه‌اند تا ظاهر فروشگاه دیده شود؛ تصویر، نام و قیمت واقعی پس از دریافت از گالری جایگزین می‌شود.</p>
        <ul className={PRODUCT_GRID}>
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

import { Container } from "@/components/ui/Container";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { demoCategories, featuredProducts } from "@/data/demo-catalog";
import { ProductBrowser } from "./ProductBrowser";

export function FeaturedProducts() {
  return (
    <section id="featured" aria-labelledby="featured-title" className="scroll-mt-24 bg-ivory-100 py-16 sm:py-24">
      <Container>
        <SectionHeading
          id="featured-title"
          eyebrow="آثار منتخب"
          title="نگاهی به آثار"
          description="این محصولات نمونه‌اند تا ظاهر فروشگاه دیده شود. تصویر، نام و قیمت واقعی پس از دریافت از گالری جایگزین می‌شود."
          aside={<PlaceholderTag label="محصولات نمونه" />}
        />
        <ProductBrowser products={featuredProducts} categories={demoCategories} />
      </Container>
    </section>
  );
}

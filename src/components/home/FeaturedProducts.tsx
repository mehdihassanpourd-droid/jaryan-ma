import { ProductCard } from "@/components/product/ProductCard";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { featuredProducts } from "@/data/demo-catalog";

export function FeaturedProducts() {
  return (
    <section id="featured" aria-labelledby="featured-title" className="scroll-mt-20 bg-ivory-100 py-16 sm:py-24">
      <Container>
        <SectionHeading
          id="featured-title"
          eyebrow="آثار منتخب"
          title="تازه‌ترین نمونه‌ها"
          description="این محصولات صرفاً نمونه‌ی نمایشی‌اند تا ظاهر فروشگاه دیده شود."
        />
        <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-4">
          {featuredProducts.map((p) => (
            <li key={p.slug}>
              <ProductCard product={p} />
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

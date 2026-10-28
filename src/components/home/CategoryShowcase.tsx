import { SampleImage } from "@/components/product/SampleImage";
import { Container } from "@/components/ui/Container";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { demoCategories, demoProducts } from "@/data/demo-catalog";
import { countByCategory } from "@/lib/catalog";
import { categoryPath } from "@/seo/urls";
import { CategoryMosaic, CategoryTile } from "./CategoryTile";

/** Sample categories, read from the data (add a category there and it joins the mosaic). With a live catalogue, `LiveShop` replaces this. */
export function CategoryShowcase() {
  return (
    <section id="collections" aria-labelledby="collections-title" className="scroll-mt-20 pt-14 sm:pt-20">
      <Container>
        <SectionHeader id="collections-title" title="دسته‌بندی‌ها" href="#featured" />
        <CategoryMosaic>
          {demoCategories.map((c, i) => (
            <li key={c.slug}>
              <CategoryTile index={i} name={c.name} sample count={countByCategory(demoProducts, c.slug)} href={categoryPath(c.slug)} media={<SampleImage art={c.art} alt={`تصویر موقت: ${c.name}`} />} />
            </li>
          ))}
        </CategoryMosaic>
      </Container>
    </section>
  );
}

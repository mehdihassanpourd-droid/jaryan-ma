import { ProductGallery } from "@/components/product/ProductGallery";
import { Badge } from "@/components/ui/Badge";
import { Container } from "@/components/ui/Container";
import { Price } from "@/components/ui/Price";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { spotlightProduct } from "@/data/demo-catalog";

export function Spotlight() {
  const p = spotlightProduct;
  return (
    <section id="spotlight" aria-labelledby="spotlight-title" className="scroll-mt-20 py-16 sm:py-24">
      <Container>
        <SectionHeading id="spotlight-title" eyebrow="نگاه نزدیک" title="هر اثر، از چند زاویه" />
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="mx-auto w-full max-w-md lg:max-w-none">
            <ProductGallery images={p.images} />
          </div>
          <div>
            <Badge tone="demo">محتوای نمونه</Badge>
            <h3 className="mt-3 text-2xl font-bold text-bark-900">{p.title}</h3>
            <p className="mt-1 text-sm text-bark-500">{p.vendorName}</p>
            <div className="mt-4">
              <Price amount={p.priceToman} />
            </div>
            <p className="mt-6 max-w-prose text-bark-600">
              در صفحه‌ی محصول، توضیحات اثر، ابعاد، مواد به‌کار رفته و داستان ساخت آن در همین بخش نمایش داده می‌شود.
              متن واقعی پس از دریافت اطلاعات از گالری جایگزین خواهد شد.
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}

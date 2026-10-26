import { ProductGallery } from "@/components/product/ProductGallery";
import { Container } from "@/components/ui/Container";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { Price } from "@/components/ui/Price";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { spotlightProduct } from "@/data/demo-catalog";

export function Spotlight() {
  const p = spotlightProduct;
  return (
    <section id="spotlight" aria-labelledby="spotlight-title" className="scroll-mt-24 py-16 sm:py-24">
      <Container>
        <SectionHeading
          id="spotlight-title"
          eyebrow="نگاه نزدیک"
          title="هر اثر، از چند زاویه"
          description="در صفحه محصول، تصاویر کامل اثر و نمای نزدیک از بافت آن را می‌بینید."
        />
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="mx-auto w-full max-w-md lg:max-w-none">
            <ProductGallery images={p.images} />
          </div>
          <div className="rounded-2xl border border-dashed border-sand-400 bg-ivory-50/70 p-6 sm:p-8">
            <PlaceholderTag label="محتوای نمونه" />
            <h3 className="mt-4 text-2xl font-bold text-bark-900">{p.title}</h3>
            <div className="mt-4">
              <Price amount={p.priceToman} />
            </div>
            <p className="mt-6 max-w-prose leading-8 text-bark-600">
              اینجا توضیحات اثر، ابعاد، مواد به‌کار رفته و داستان ساخت آن نمایش داده می‌شود. متن واقعی پس از دریافت اطلاعات از گالری
              جایگزین خواهد شد.
            </p>
            <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-sand-200 pt-6 text-sm">
              {["ابعاد", "مواد"].map((label) => (
                <div key={label}>
                  <dt className="text-bark-500">{label}</dt>
                  <dd className="mt-1 text-bark-600">ثبت نشده</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Container>
    </section>
  );
}

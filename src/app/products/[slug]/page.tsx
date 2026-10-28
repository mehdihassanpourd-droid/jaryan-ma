import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PhotoGallery } from "@/components/product/PhotoGallery";
import { ProductGallery } from "@/components/product/ProductGallery";
import { ArtistNote, chipClass, PricePanel, ProductChips } from "@/components/product/ProductInfo";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumb, type Crumb } from "@/components/ui/Breadcrumb";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { Price } from "@/components/ui/Price";
import { formatNumber } from "@/lib/format";
import { SeoProductCard } from "@/components/product/SeoProductCard";
import { LIVE_CATALOG_BASE } from "@/lib/live-config";
import { liveProductHref } from "@/lib/live-catalog";
import { site } from "@/lib/site";
import { loadSeo } from "@/seo";
import { lowestPrice, relatedProducts } from "@/seo/catalog-seo";
import { JsonLd } from "@/seo/JsonLd";
import { breadcrumbJsonLd, productJsonLd } from "@/seo/jsonld";
import { categoryPath, decodeParam } from "@/seo/urls";

// Static export: only the products in the catalogue get a page; anything else is the site's 404.
export const dynamicParams = false;

type Props = { params: Promise<{ slug: string }> };

async function find(params: Props["params"]) {
  const slug = decodeParam((await params).slug);
  const { catalog, seo } = await loadSeo();
  const product = catalog.products.find((p) => p.slug === slug);
  const meta = product ? seo.products.get(product.slug) : undefined;
  return product && meta ? { product, meta, seo } : null;
}

export async function generateStaticParams() {
  const { catalog } = await loadSeo();
  return catalog.products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await find(params);
  if (!found) return {};
  const { product, meta } = found;
  const image = meta.images.find((i) => !i.placeholder && i.url);
  return {
    title: meta.title,
    description: meta.description,
    ...(meta.canonical ? { alternates: { canonical: meta.canonical } } : {}),
    // Sample products are never indexed; real ones are, once the site is launched.
    robots: meta.indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      title: meta.title,
      description: meta.description,
      type: "website",
      locale: "fa_IR",
      siteName: site.name,
      ...(meta.canonical ? { url: meta.canonical } : {}),
      ...(image ? { images: [{ url: image.url, alt: image.alt }] } : {}),
    },
    twitter: { card: image ? "summary_large_image" : "summary", title: meta.title, description: meta.description },
    other: product.isDemo ? { "x-sample-content": "true" } : {},
  };
}

const AVAILABILITY_LABEL = { in_stock: "موجود", sold_out: "ناموجود", made_to_order: "ساخت پس از سفارش" } as const;

export default async function ProductPage({ params }: Props) {
  const found = await find(params);
  if (!found) notFound();
  const { product, meta, seo } = found;
  const related = relatedProducts((await loadSeo()).catalog, product).flatMap((p) => {
    const m = seo.products.get(p.slug);
    return m ? [{ product: p, meta: m }] : [];
  });
  const price = lowestPrice(product);
  const category = product.category ? seo.categories.get(product.category.slug) : undefined;
  const crumbs: Crumb[] = [
    { name: "خانه", href: "/" },
    ...(category ? [{ name: category.name, href: categoryPath(category.slug) }] : []),
    { name: product.name },
  ];
  const allPlaceholders = meta.images.length > 0 && meta.images.every((i) => i.placeholder);

  return (
    <>
      <JsonLd data={[productJsonLd(product, seo), breadcrumbJsonLd(product, seo)]} />
      <Container className="pb-4 pt-5 sm:pt-10">
        <Breadcrumb items={crumbs} />
        <div className="mt-5 grid items-start gap-9 lg:grid-cols-2 lg:gap-16">
          <div className="mx-auto w-full max-w-md lg:max-w-none">
            {allPlaceholders ? (
              <ProductGallery images={meta.images.map((i) => ({ art: i.placeholder!.art, alt: i.alt }))} />
            ) : (
              <PhotoGallery images={meta.images.filter((i) => i.url)} />
            )}
          </div>
          <div>
            <ProductChips>
              {product.isDemo && <PlaceholderTag label="محتوای نمونه" />}
              {category && (
                <Link href={categoryPath(category.slug)} className={`${chipClass} hover:bg-teal-500 hover:text-ivory-50`}>
                  {category.name}
                </Link>
              )}
              {product.fulfillment === "unique" && <Badge tone="olive">اثر یگانه</Badge>}
              {!product.isDemo && <Badge tone="neutral">{AVAILABILITY_LABEL[product.availability]}</Badge>}
            </ProductChips>
            <h1 className="mt-4 text-balance text-3xl font-black leading-[1.4] text-bark-900 sm:text-4xl">{product.name}</h1>
            <PricePanel>
              {price?.from && <span className="text-sm text-bark-600">از</span>}
              <Price amount={price?.amount ?? null} />
            </PricePanel>
            {product.availability === "made_to_order" && product.leadTimeDays && (
              <p className="mt-3 text-sm text-bark-600">زمان ساخت: {formatNumber(product.leadTimeDays)} روز</p>
            )}
            {product.isDemo ? (
              <p className="mt-6 max-w-prose leading-8 text-bark-700">
                این صفحه نمونه است و اطلاعات واقعی ندارد. توضیحات، ابعاد، مواد و قیمت واقعی پس از دریافت از گالری جایگزین می‌شود.
              </p>
            ) : (
              product.description.trim() && <p className="mt-6 max-w-prose whitespace-pre-line leading-8 text-bark-700">{product.description.trim()}</p>
            )}
            {product.isDemo && (
              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-sand-200 pt-5 text-sm">
                {["ابعاد", "مواد"].map((label) => (
                  <div key={label}>
                    <dt className="text-bark-600">{label}</dt>
                    <dd className="mt-1 text-bark-700">ثبت نشده</dd>
                  </div>
                ))}
              </dl>
            )}
            {product.variants.length > 0 && (
              <section aria-labelledby="variants-title" className="mt-8">
                <h2 id="variants-title" className="mb-3 text-base font-bold text-bark-900">
                  گزینه‌ها
                </h2>
                <ul className="divide-y divide-sand-200 overflow-hidden rounded-[1.5rem] border border-sand-200 bg-ivory-50">
                  {product.variants.map((v) => (
                    <li key={v.sku} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                      <span className="text-bark-700">{Object.values(v.options).join("، ") || v.sku}</span>
                      <span className="flex items-center gap-3">
                        <Price amount={v.priceToman} />
                        <span className="text-xs text-bark-600">{v.available ? "موجود" : "ناموجود"}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {LIVE_CATALOG_BASE && !product.isDemo && product.availability !== "sold_out" && (
                <ButtonLink href={liveProductHref(product.slug)} size="lg" data-testid="buy-link">انتخاب گزینه و افزودن به سبد خرید</ButtonLink>
              )}
              <ButtonLink href={site.instagramUrl} target="_blank" rel="noopener noreferrer" variant="secondary" size="lg">
                <InstagramIcon className="h-5 w-5" />
                <span>پرسش درباره این اثر در اینستاگرام</span>
              </ButtonLink>
            </div>
            {product.isDemo && <ArtistNote />}
          </div>
        </div>
        {related.length > 0 && (
          <section aria-labelledby="related-title" className="mt-16" data-testid="related-products">
            <h2 id="related-title" className="mb-6 text-2xl font-black text-bark-900">آثار دیگر این دسته</h2>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 lg:grid-cols-4">
              {related.map(({ product: p, meta: m }) => (
                <li key={p.slug}>
                  <SeoProductCard product={p} seo={m} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </Container>
    </>
  );
}

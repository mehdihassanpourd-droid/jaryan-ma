import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SeoProductCard } from "@/components/product/SeoProductCard";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Container } from "@/components/ui/Container";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { formatNumber } from "@/lib/format";
import { site } from "@/lib/site";
import { loadSeo } from "@/seo";
import { JsonLd } from "@/seo/JsonLd";
import { categoryBreadcrumbJsonLd, categoryCollectionJsonLd } from "@/seo/jsonld";
import { decodeParam } from "@/seo/urls";

export const dynamicParams = false;

type Props = { params: Promise<{ slug: string }> };

async function find(params: Props["params"]) {
  const slug = decodeParam((await params).slug);
  const { catalog, seo } = await loadSeo();
  const meta = seo.categories.get(slug);
  if (!meta) return null;
  const products = meta.productSlugs.flatMap((s) => {
    const product = catalog.products.find((p) => p.slug === s);
    const productSeo = seo.products.get(s);
    return product && productSeo ? [{ product, seo: productSeo }] : [];
  });
  const isDemo = catalog.categories.find((c) => c.slug === slug)?.isDemo ?? true;
  return { meta, products, isDemo, seo };
}

export async function generateStaticParams() {
  const { seo } = await loadSeo();
  return [...seo.categories.keys()].map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await find(params);
  if (!found) return {};
  const { meta } = found;
  return {
    title: meta.title,
    description: meta.description,
    ...(meta.canonical ? { alternates: { canonical: meta.canonical } } : {}),
    robots: meta.indexable ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: { title: meta.title, description: meta.description, type: "website", locale: "fa_IR", siteName: site.name, ...(meta.canonical ? { url: meta.canonical } : {}) },
  };
}

export default async function CategoryPage({ params }: Props) {
  const found = await find(params);
  if (!found) notFound();
  const { meta, products, isDemo, seo } = found;
  return (
    <>
      <JsonLd data={[categoryBreadcrumbJsonLd(meta.slug, seo), categoryCollectionJsonLd(meta.slug, seo)]} />
      <Container className="py-10 sm:py-14">
        <Breadcrumb items={[{ name: "خانه", href: "/" }, { name: meta.name }]} />
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-bark-900 sm:text-3xl">{meta.name}</h1>
          {isDemo && <PlaceholderTag label="دسته نمونه" />}
        </div>
        <p className="mt-2 text-sm text-bark-600">{formatNumber(products.length)} اثر</p>
        <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 lg:grid-cols-4">
          {products.map(({ product, seo: productSeo }) => (
            <li key={product.slug}>
              <SeoProductCard product={product} seo={productSeo} />
            </li>
          ))}
        </ul>
      </Container>
    </>
  );
}

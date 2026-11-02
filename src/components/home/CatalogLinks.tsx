import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { formatNumber } from "@/lib/format";
import { loadSeo } from "@/seo";

/** The most products listed on the home page (the rest are one click away, on their category page and in the sitemap). */
const MAX_PRODUCT_LINKS = 60;

/**
 * Plain, server-rendered links to every indexable category and (up to a limit) product, built from the REAL catalogue at build time.
 * The product grid above is read in the visitor's browser, so without this the home page would give crawlers nothing to follow.
 * Rendered only for a real, launched catalogue: sample content is never linked from here.
 */
export async function CatalogLinks() {
  const { catalog, seo } = await loadSeo();
  if (catalog.source !== "snapshot" || !seo.settings.indexing) return null;
  const categories = [...seo.categories.values()].filter((c) => c.indexable).sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const products = [...seo.products.values()].filter((p) => p.indexable).sort((a, b) => (a.slug < b.slug ? -1 : 1)).slice(0, MAX_PRODUCT_LINKS);
  if (categories.length === 0 && products.length === 0) return null;
  const nameOf = new Map(catalog.products.map((p) => [p.slug, p.name]));
  return (
    <nav aria-labelledby="catalog-links-title" className="py-12 sm:py-16" data-testid="catalog-links">
      <Container>
        <SectionHeading id="catalog-links-title" eyebrow="فهرست" title="دسته‌ها و آثار" />
        {categories.length > 0 && (
          <ul className="mt-6 flex flex-wrap gap-3" aria-label="دسته‌ها">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link href={c.path} className="inline-flex min-h-11 items-center border border-sand-300 px-5 text-sm text-bark-800 hover:bg-sand-100">
                  {c.name} <span className="ms-2 text-xs text-bark-500">({formatNumber(c.productSlugs.length)})</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {products.length > 0 && (
          <ul className="mt-6 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3" aria-label="آثار">
            {products.map((p) => (
              <li key={p.slug}>
                <Link href={p.path} className="inline-flex min-h-11 items-center text-sm text-bark-700 underline-offset-4 hover:underline">
                  {nameOf.get(p.slug) ?? p.slug}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Container>
    </nav>
  );
}

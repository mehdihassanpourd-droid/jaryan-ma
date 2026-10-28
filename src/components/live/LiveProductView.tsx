"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { Price } from "@/components/ui/Price";
import { GalleryFrame, thumbClass } from "@/components/product/GalleryFrame";
import { PricePanel, ProductChips } from "@/components/product/ProductInfo";
import { AddToCart } from "@/components/shop/AddToCart";
import { formatNumber } from "@/lib/format";
import { isLiveSlug, livePrice, safeImageUrl } from "@/lib/live-catalog";
import type { PublicProduct } from "@/domain/product/snapshot";
import { site } from "@/lib/site";
import { useLiveCatalog, useLoad } from "./useLiveCatalog";

const AVAILABILITY_LABEL = { in_stock: "موجود", sold_out: "ناموجود", made_to_order: "ساخت پس از سفارش" } as const;

function Notice({ children, alert }: { children: string; alert?: boolean }) {
  return (
    <Container className="py-16">
      <p role={alert ? "alert" : "status"} className=" border border-sand-300 bg-ivory-50 p-6 text-bark-700">{children}</p>
      <p className="mt-6"><Link href="/" className="text-olive-700 underline">بازگشت به صفحهٔ اصلی</Link></p>
    </Container>
  );
}

/** One PUBLISHED product, read from the live catalogue by `?slug=`. A draft, archived or unknown slug has no file: "not found". */
export function LiveProductView() {
  const slug = useSearchParams().get("slug") ?? "";
  const catalog = useLiveCatalog();
  const result = useLoad(catalog && isLiveSlug(slug) ? () => catalog.loadProduct(slug) : null, `product:${slug}`);

  if (!catalog) return <Notice>این صفحه فقط برای فروشگاه متصل به فهرست محصولات کار می‌کند.</Notice>;
  if (!isLiveSlug(slug)) return <Notice>این محصول پیدا نشد.</Notice>;
  if (result.state === "loading") return <Notice>در حال دریافت محصول…</Notice>;
  if (result.state === "error") return <Notice alert>در حال حاضر دریافت محصول ممکن نیست. چند دقیقهٔ دیگر دوباره سر بزنید.</Notice>;
  const product = result.value;
  if (!product) return <Notice>این محصول در حال حاضر در فروشگاه نیست.</Notice>;
  return <ProductDetails key={product.slug} product={product} />;
}

function ProductDetails({ product }: { product: PublicProduct }) {
  // The option the shopper picked (a SKU); starts on the first one that can be bought.
  const [sku, setSku] = useState<string | null>(() => product.variants.find((v) => v.available)?.sku ?? null);
  const price = livePrice(product);
  const images = product.images.flatMap((i) => {
    const url = safeImageUrl(i.url);
    return url ? [{ url, alt: i.alt || product.name }] : [];
  });
  return (
    <Container className="pb-4 pt-5 sm:pt-10">
      <Breadcrumb items={[{ name: "خانه", href: "/" }, ...(product.category ? [{ name: product.category.name }] : []), { name: product.name }]} />
      <div className="mt-8 grid items-start gap-16 lg:grid-cols-12 lg:gap-12" data-testid="live-product">
        <div className="w-full pe-4 sm:pe-6 lg:col-span-7 space-y-4" role="group" aria-label="تصاویر محصول">
          {images[0] && (
            <GalleryFrame>
              {/* eslint-disable-next-line @next/next/no-img-element -- static export: no image optimiser */}
              <img src={images[0].url} alt={images[0].alt} className="h-full w-full object-cover" decoding="async" />
            </GalleryFrame>
          )}
          {images.length > 1 && (
            <ul className="grid grid-cols-4 gap-3">
              {images.slice(1).map((img) => (
                <li key={img.url} className={`${thumbClass} ring-sand-200`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- static export: no image optimiser */}
                  <img src={img.url} alt={img.alt} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="lg:col-span-5 lg:pt-10">
          <ProductChips>
            {product.category && <span className="inline-flex min-h-8 items-center bg-teal-100 px-3.5 text-sm font-medium text-teal-800">{product.category.name}</span>}
            {product.fulfillment === "unique" && <Badge tone="olive">اثر یگانه</Badge>}
            <Badge tone="neutral">{AVAILABILITY_LABEL[product.availability]}</Badge>
          </ProductChips>
          <h1 className="mt-5 text-balance text-5xl font-black leading-[1.2] text-bark-900 sm:text-6xl">{product.name}</h1>
          <PricePanel>
            {price.from && <span className="text-sm text-bark-600">از</span>}
            <Price amount={price.amount} />
          </PricePanel>
          {product.availability === "made_to_order" && product.leadTimeDays && <p className="mt-3 text-sm text-bark-600">زمان ساخت: {formatNumber(product.leadTimeDays)} روز</p>}
          {product.description.trim() && <p className="mt-6 max-w-prose whitespace-pre-line leading-8 text-bark-700">{product.description.trim()}</p>}
          {product.variants.length > 0 && (
            <section aria-labelledby="variants-title" className="mt-8">
              <h2 id="variants-title" className="mb-3 text-base font-bold text-bark-900">گزینه‌ها</h2>
              <ul className="divide-y divide-sand-200 overflow-hidden border border-sand-200 bg-ivory-50">
                {product.variants.map((v) => (
                  <li key={v.sku} className="text-sm">
                    <label className={`flex min-h-12 cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 ${v.available ? "" : "cursor-not-allowed opacity-60"}`}>
                      <span className="flex items-center gap-3 text-bark-700">
                        <input type="radio" name="variant" value={v.sku} checked={sku === v.sku} disabled={!v.available} onChange={() => setSku(v.sku)} className="h-5 w-5 accent-clay-600" />
                        {Object.values(v.options).join("، ") || v.sku}
                      </span>
                      <span className="flex items-center gap-3">
                        <Price amount={v.priceToman} />
                        <span className="text-xs text-bark-600">{v.available ? "موجود" : "ناموجود"}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <AddToCart product={product} sku={sku} />
          <div className="mt-6">
            <ButtonLink href={site.instagramUrl} target="_blank" rel="noopener noreferrer" variant="secondary" size="lg">
              <InstagramIcon className="h-5 w-5" />
              <span>پرسش درباره این اثر در اینستاگرام</span>
            </ButtonLink>
          </div>
        </div>
      </div>
    </Container>
  );
}

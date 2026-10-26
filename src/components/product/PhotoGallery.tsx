import type { ImageSeo } from "@/seo/catalog-seo";

/**
 * Real product photographs. Server-rendered with no script, so every image and its alt text is in the HTML
 * that search engines read. (A static export has no image optimiser, hence plain <img> with lazy loading.)
 */
export function PhotoGallery({ images }: { images: ImageSeo[] }) {
  const [first, ...rest] = images;
  if (!first) return null;
  return (
    <div className="space-y-3" role="group" aria-label="تصاویر محصول">
      <div className="aspect-[4/5] overflow-hidden rounded-2xl bg-sand-100 shadow-soft ring-1 ring-sand-200">
        {/* eslint-disable-next-line @next/next/no-img-element -- static export: no image optimiser */}
        <img src={first.url} alt={first.alt} className="h-full w-full object-cover" fetchPriority="high" decoding="async" />
      </div>
      {rest.length > 0 && (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {rest.map((img) => (
            <li key={img.url} className="aspect-square overflow-hidden rounded-xl bg-sand-100 ring-1 ring-sand-200">
              {/* eslint-disable-next-line @next/next/no-img-element -- static export: no image optimiser */}
              <img src={img.url} alt={img.alt} className="h-full w-full object-cover" loading="lazy" decoding="async" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

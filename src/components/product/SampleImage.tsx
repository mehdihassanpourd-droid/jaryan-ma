import type { SampleArt } from "@/types/catalog";

interface SampleImageProps {
  art: SampleArt;
  /** Persian alt text; an empty string marks the picture as decorative. */
  alt: string;
  className?: string;
  /** The first, above-the-fold picture of a page. */
  priority?: boolean;
}

/**
 * A temporary sample illustration (public/sample/*.svg) standing in for product photography. Plain <img> because the
 * static export has no image optimiser; the callers always show a "تصویر موقت" label next to it.
 */
export function SampleImage({ art, alt, className = "", priority = false }: SampleImageProps) {
  const square = art.startsWith("artist-");
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export: no image optimiser
    <img
      src={`/sample/${art}.svg`}
      alt={alt}
      width={800}
      height={square ? 800 : 1000}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={`block h-full w-full object-cover ${className}`}
    />
  );
}

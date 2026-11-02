import { site } from "@/lib/site";

/** Width / height of the official mark (702 x 996, cropped from the original file with no square around it). */
const RATIO = 702 / 996;

interface LogoProps {
  /** `cream`: the logo's own colours, for burgundy fields. `burgundy`: the same shapes reversed, for light surfaces. */
  tone?: "cream" | "burgundy";
  /** Displayed height in CSS pixels. */
  height: number;
  className?: string;
  /** Header: load at once. Elsewhere the picture is lazy like every other one. */
  eager?: boolean;
}

/**
 * The OFFICIAL logo (public/brand, extracted from brand/original with scripts/brand/make-logo-assets.mjs). Never redraw it:
 * only its size and which of the two colourways is used may change.
 */
export function Logo({ tone = "cream", height, className = "", eager = false }: LogoProps) {
  const width = Math.round(height * RATIO);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static export: no image optimiser
    <img
      src={`/brand/jaryan-ma-mark-${tone}-240.png`}
      srcSet={`/brand/jaryan-ma-mark-${tone}-240.png 169w, /brand/jaryan-ma-mark-${tone}.png 677w`}
      sizes={`${width}px`}
      width={width}
      height={height}
      alt={site.name}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={`block max-w-none ${className}`}
    />
  );
}

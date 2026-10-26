import type { Tone } from "@/types/catalog";

const palettes: Record<Tone, { bg: string; a: string; b: string }> = {
  ivory: { bg: "#f0e8d6", a: "#ddcdb0", b: "#c9b48f" },
  sand: { bg: "#ddcdb0", a: "#c9b48f", b: "#8a6a4a" },
  bark: { bg: "#8a6a4a", a: "#6f5239", b: "#c9b48f" },
  olive: { bg: "#a9b085", a: "#7a8456", b: "#e4e6d3" },
};

interface ArtPlaceholderProps {
  tone: Tone;
  alt: string;
  className?: string;
}

/**
 * Abstract SVG stand-in for product photography. Swap for `next/image`
 * once real images exist; keep the same `alt` contract.
 */
export function ArtPlaceholder({ tone, alt, className = "" }: ArtPlaceholderProps) {
  const p = palettes[tone];
  return (
    <svg
      role="img"
      aria-label={alt}
      viewBox="0 0 400 500"
      preserveAspectRatio="xMidYMid slice"
      className={`block h-full w-full ${className}`}
    >
      <rect width="400" height="500" fill={p.bg} />
      <circle cx="270" cy="170" r="110" fill={p.a} opacity="0.85" />
      <path d="M0 380 Q120 300 240 360 T400 330 V500 H0Z" fill={p.b} opacity="0.7" />
      <path d="M0 430 Q140 380 260 420 T400 400 V500 H0Z" fill={p.a} opacity="0.9" />
    </svg>
  );
}

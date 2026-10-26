import { useId } from "react";
import type { Motif, Tone } from "@/types/catalog";

interface Palette {
  bg: string;
  a: string;
  b: string;
  c: string;
  rod: string;
}

const palettes: Record<Tone, Palette> = {
  ivory: { bg: "#f0e8d6", a: "#ddcdb0", b: "#c9b48f", c: "#8a6a4a", rod: "#8a6a4a" },
  sand: { bg: "#ddcdb0", a: "#c9b48f", b: "#8a6a4a", c: "#f8f3e8", rod: "#6f5239" },
  bark: { bg: "#8a6a4a", a: "#6f5239", b: "#c9b48f", c: "#f0e8d6", rod: "#2e2318" },
  olive: { bg: "#a9b085", a: "#7a8456", b: "#e4e6d3", c: "#55402d", rod: "#55402d" },
};

interface ArtPlaceholderProps {
  tone: Tone;
  motif?: Motif;
  alt: string;
  className?: string;
}

interface MotifProps {
  p: Palette;
}

/** Hanging dowel with cords and a woven panel, finished with a fringe. */
function Fringe({ p }: MotifProps) {
  const strands = Array.from({ length: 23 }, (_, i) => 90 + i * 10);
  return (
    <>
      <path d="M96 74 L200 26 L304 74" fill="none" stroke={p.rod} strokeWidth="3" strokeLinejoin="round" />
      <rect x="72" y="68" width="256" height="12" rx="6" fill={p.rod} />
      <rect x="90" y="82" width="220" height="214" fill={p.a} stroke={p.rod} strokeOpacity="0.25" />
      <rect x="90" y="82" width="220" height="40" fill={p.b} />
      <rect x="90" y="262" width="220" height="34" fill={p.b} />
      <polygon points="200,150 250,210 200,270 150,210" fill={p.c} />
      <polygon points="200,178 226,210 200,242 174,210" fill={p.a} />
      {strands.map((x, i) => (
        <line key={x} x1={x} y1="296" x2={x} y2={372 + ((i * 37) % 5) * 12} stroke={p.b} strokeWidth="4" strokeLinecap="round" />
      ))}
    </>
  );
}

/** Boho-style concentric arches. */
function Arch({ p }: MotifProps) {
  const rings: Array<[number, string]> = [
    [112, p.b],
    [86, p.c],
    [60, p.a],
    [34, p.bg],
  ];
  return (
    <>
      <rect x="0" y="410" width="400" height="90" fill={p.a} opacity="0.7" />
      {rings.map(([r, fill]) => (
        <path key={r} d={`M${200 - r} 410 V270 A${r} ${r} 0 0 1 ${200 + r} 270 V410 Z`} fill={fill} />
      ))}
      {[150, 175, 200, 225, 250].map((x) => (
        <line key={x} x1={x} y1="410" x2={x} y2="440" stroke={p.rod} strokeOpacity="0.35" strokeWidth="3" strokeLinecap="round" />
      ))}
    </>
  );
}

/** Framed panel with nested diamonds. */
function Diamond({ p }: MotifProps) {
  const rings: Array<[number, string]> = [
    [120, p.b],
    [92, p.c],
    [64, p.a],
    [36, p.rod],
  ];
  return (
    <>
      <rect x="72" y="62" width="256" height="12" rx="6" fill={p.rod} />
      <rect x="80" y="76" width="240" height="320" fill={p.a} stroke={p.rod} strokeOpacity="0.25" />
      {rings.map(([r, fill]) => (
        <polygon key={r} points={`200,${240 - r} ${200 + r},240 200,${240 + r} ${200 - r},240`} fill={fill} />
      ))}
      {Array.from({ length: 13 }, (_, i) => 90 + i * 18).map((x) => (
        <line key={x} x1={x} y1="396" x2={x} y2="428" stroke={p.b} strokeWidth="4" strokeLinecap="round" />
      ))}
    </>
  );
}

/** Striped runner / rug. */
function Stripes({ p }: MotifProps) {
  const fills = [p.b, p.c, p.a, p.rod];
  const heights = [30, 10, 44, 10, 60, 10, 44, 10, 40, 10, 52, 10, 44, 10, 46];
  let y = 60;
  const bands: Array<{ y: number; h: number; fill: string }> = [];
  heights.forEach((h, i) => {
    const clipped = Math.min(h, 440 - y);
    if (clipped > 0) bands.push({ y, h: clipped, fill: fills[i % fills.length]! });
    y += h;
  });
  return (
    <>
      <rect x="70" y="60" width="260" height="380" rx="4" fill={p.a} />
      {bands.map((b) => (
        <rect key={b.y} x="70" y={b.y} width="260" height={b.h} fill={b.fill} />
      ))}
      {Array.from({ length: 14 }, (_, i) => 76 + i * 19).map((x) => (
        <g key={x} stroke={p.b} strokeWidth="3.5" strokeLinecap="round">
          <line x1={x} y1="440" x2={x} y2="470" />
          <line x1={x} y1="60" x2={x} y2="40" />
        </g>
      ))}
    </>
  );
}

/** Soft layered hills; a calm fallback. */
function Waves({ p }: MotifProps) {
  return (
    <>
      <circle cx="270" cy="170" r="110" fill={p.a} opacity="0.85" />
      <path d="M0 380 Q120 300 240 360 T400 330 V500 H0Z" fill={p.b} opacity="0.7" />
      <path d="M0 430 Q140 380 260 420 T400 400 V500 H0Z" fill={p.a} opacity="0.9" />
    </>
  );
}

/** Close-up of an over/under weave. */
function Detail({ p }: MotifProps) {
  const fills = [p.a, p.b, p.c];
  const cells: React.ReactNode[] = [];
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 10; col++) {
      const x = col * 40;
      const y = row * 40;
      const horizontal = (row + col) % 2 === 0;
      cells.push(
        <rect
          key={`${row}-${col}`}
          x={horizontal ? x + 3 : x + 11}
          y={horizontal ? y + 11 : y + 3}
          width={horizontal ? 34 : 18}
          height={horizontal ? 18 : 34}
          rx="9"
          fill={fills[(row * 2 + col) % fills.length]}
        />,
      );
    }
  }
  return <>{cells}</>;
}

const motifs: Record<Motif, (props: MotifProps) => React.ReactNode> = {
  fringe: Fringe,
  arch: Arch,
  diamond: Diamond,
  stripes: Stripes,
  waves: Waves,
  detail: Detail,
};

/**
 * Abstract SVG stand-in for product photography (woven wall art motifs).
 * Swap for real images once they exist; keep the same `alt` contract.
 * An empty `alt` marks the artwork as decorative.
 */
export function ArtPlaceholder({ tone, motif = "waves", alt, className = "" }: ArtPlaceholderProps) {
  const p = palettes[tone];
  const weaveId = `weave${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const Art = motifs[motif];

  return (
    <svg
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      viewBox="0 0 400 500"
      preserveAspectRatio="xMidYMid slice"
      className={`block h-full w-full ${className}`}
    >
      <defs>
        <pattern id={weaveId} width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M0 4h8M4 0v8" stroke="#2e2318" strokeOpacity="0.09" />
        </pattern>
      </defs>
      <rect width="400" height="500" fill={p.bg} />
      <Art p={p} />
      <rect width="400" height="500" fill={`url(#${weaveId})`} />
    </svg>
  );
}

/**
 * Decorative hand-painted marks (leaf branch, brush strokes). Purely visual: `aria-hidden`, no text, colours from the theme tokens.
 */
export function LeafBranch({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 200" aria-hidden="true" className={className} fill="none">
      <path d="M150 190C110 150 70 110 30 20" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      {[
        [138, 168, -50],
        [112, 138, 52],
        [94, 112, -48],
        [76, 84, 50],
        [58, 56, -46],
        [44, 30, 48],
      ].map(([x, y, a], i) => (
        <path key={i} d="M0 0C14-14 16-38 0-62-16-38-14-14 0 0Z" transform={`translate(${x} ${y}) rotate(${a})`} fill="currentColor" opacity={i % 2 ? 0.85 : 1} />
      ))}
    </svg>
  );
}

/** Two painted strokes, one in each of the brand's warm/cool accents. */
export function BrushStrokes({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 180" aria-hidden="true" className={`overflow-visible ${className}`} fill="none" preserveAspectRatio="none">
      <path d="M-10 60C60 20 150 70 330 8" stroke="var(--color-teal-500)" strokeWidth="44" strokeLinecap="round" opacity="0.9" />
      <path d="M-10 128C70 92 170 140 330 78" stroke="var(--color-clay-500)" strokeWidth="38" strokeLinecap="round" opacity="0.92" />
      <path d="M20 94C90 70 170 104 260 62" stroke="var(--color-ivory-100)" strokeWidth="5" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

/** The organic dark-teal field behind the hero: a wide pebble with a wavy lower edge. */
export function HeroField({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 600" preserveAspectRatio="none" aria-hidden="true" className={className}>
      <path d="M0 0H400V455C400 530 340 580 262 560C206 546 178 500 118 506C52 513 0 556 0 470Z" fill="var(--color-teal-900)" />
      <path d="M400 0V300C340 320 300 260 316 190C330 130 372 90 400 70Z" fill="var(--color-teal-700)" opacity="0.55" />
      <path d="M-20 520C40 470 90 500 150 540" stroke="var(--color-clay-500)" strokeWidth="26" strokeLinecap="round" fill="none" opacity="0.9" />
    </svg>
  );
}

/** A wavy upper edge for a coloured band: paints the page background over the band's top so the edge is organic, not a straight cut. */
export function WaveTop({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 24" preserveAspectRatio="none" aria-hidden="true" className={`pointer-events-none absolute inset-x-0 top-0 h-5 w-full text-ivory-50 sm:h-7 ${className}`}>
      <path d="M0 0H400V9C335 26 270 -6 200 10S70 24 0 7Z" fill="currentColor" />
    </svg>
  );
}

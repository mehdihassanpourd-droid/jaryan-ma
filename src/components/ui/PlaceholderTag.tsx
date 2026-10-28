/**
 * Marks content as placeholder (not real business information).
 * Pair with `PlaceholderPanel` for blocks; real information uses plain styling.
 */
export function PlaceholderTag({ label = "نمونه" }: { label?: string }) {
  return (
    <span className="inline-flex items-center border border-dashed border-bark-700 bg-ivory-50 px-2.5 py-0.5 text-xs font-bold text-bark-900">
      {label}
    </span>
  );
}

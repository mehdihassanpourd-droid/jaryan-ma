/**
 * Marks content as placeholder (not real business information).
 * Pair with `PlaceholderPanel` for blocks; real information uses plain styling.
 */
export function PlaceholderTag({ label = "نمونه" }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-dashed border-sand-400 bg-ivory-50/95 px-2.5 py-0.5 text-xs font-medium text-bark-700">
      {label}
    </span>
  );
}

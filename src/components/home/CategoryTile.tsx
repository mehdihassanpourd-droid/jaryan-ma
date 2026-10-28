import Link from "next/link";
import type { ReactNode } from "react";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { formatNumber } from "@/lib/format";

interface CategoryTileProps {
  index: number;
  name: string;
  media: ReactNode;
  count?: number;
  sample?: boolean;
  /** A page link (sample/snapshot catalogue) or a selection handler (live catalogue filter). */
  href?: string;
  onSelect?: () => void;
  active?: boolean;
}

/** One category: its picture fills a straight-edged rectangle and the name sits on a white wall label at the corner. */
export function CategoryTile({ name, media, count, sample = false, href, onSelect, active }: CategoryTileProps) {
  const frame = `group relative block h-full w-full overflow-hidden bg-sand-100 text-start ${active ? "outline outline-4 outline-offset-2 outline-clay-600" : ""}`;
  const body = (
    <>
      <span className="absolute inset-0 block transition-transform duration-500 group-hover:scale-[1.03]">{media}</span>
      {sample && (
        <span className="absolute start-3 top-3">
          <PlaceholderTag />
        </span>
      )}
      <span className="absolute bottom-0 start-0 block max-w-[88%] bg-ivory-50 px-4 py-2.5 transition-colors group-hover:bg-bark-900 group-hover:text-ivory-50">
        <span className="block text-base font-black leading-6 sm:text-2xl sm:leading-8">{name}</span>
        {count !== undefined && <span className="block text-xs font-medium">{formatNumber(count)} اثر{sample ? " نمونه" : ""}</span>}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className={frame}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onSelect} aria-pressed={active} className={frame}>
      {body}
    </button>
  );
}

/**
 * The asymmetric wall: two columns of unequal width; in every group of three, the first tile is tall and the other two stack beside it,
 * so any number of categories keeps the rhythm and no two neighbours are the same size.
 */
export function CategoryMosaic({ children }: { children: ReactNode }) {
  return (
    <ul className="grid auto-rows-[12.5rem] grid-cols-[1.45fr_1fr] gap-3 sm:auto-rows-[15rem] sm:gap-5 lg:auto-rows-[19rem] [&>li:nth-child(3n+1)]:row-span-2">
      {children}
    </ul>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import { formatNumber } from "@/lib/format";

/** Organic frames, assigned by position so any number of categories keeps the asymmetric rhythm (see `CategoryMosaic`). */
const SHAPES = ["blob-a", "blob-c", "blob-d"] as const;

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

/** One category: its picture in an organic frame, the name over a soft shade at the bottom, an optional count. */
export function CategoryTile({ index, name, media, count, sample = false, href, onSelect, active }: CategoryTileProps) {
  const shape = SHAPES[index % SHAPES.length];
  const frame = `group relative block h-full w-full overflow-hidden ${shape} bg-sand-100 text-start ring-1 ring-sand-200 ${active ? "outline outline-[3px] outline-offset-2 outline-clay-600" : ""}`;
  const body = (
    <>
      <span className="absolute inset-0 block transition-transform duration-500 group-hover:scale-[1.04]">{media}</span>
      <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-bark-900/80 via-bark-900/10 to-transparent" />
      {sample && (
        <span className="absolute start-[18%] top-[9%]">
          <PlaceholderTag />
        </span>
      )}
      <span className="absolute inset-x-[17%] bottom-[16%] block">
        <span className="block text-lg font-black leading-7 text-ivory-50 sm:text-xl">{name}</span>
        {count !== undefined && <span className="block text-xs text-ivory-50/90">{formatNumber(count)} اثر{sample ? " نمونه" : ""}</span>}
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

/** The mosaic grid: in every group of three, the first tile is tall on one side and the other two stack beside it. */
export function CategoryMosaic({ children }: { children: ReactNode }) {
  return (
    <ul className="mx-auto grid auto-rows-[9.75rem] grid-cols-2 gap-3 sm:auto-rows-[13rem] sm:gap-4 lg:max-w-4xl lg:auto-rows-[15rem] [&>li:nth-child(3n+1)]:row-span-2">
      {children}
    </ul>
  );
}

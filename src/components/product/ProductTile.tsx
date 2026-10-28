import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";

interface ProductTileProps {
  href: string;
  name: string;
  /** The picture: a `SampleImage` or a real <img>. It fills a 4:5 frame. */
  media: ReactNode;
  categoryName?: string;
  /** Price (or the "not announced" note) and any availability note. */
  price: ReactNode;
  /** Sample content carries the visible «نمونه» tag. */
  sample?: boolean;
  unique?: boolean;
  /** Extra badges (e.g. "ناموجود"). */
  extra?: ReactNode;
}

/** The one product card: a large 4:5 picture in a soft frame, the category, the name and the price. Used by every product list. */
export function ProductTile({ href, name, media, categoryName, price, sample = false, unique = false, extra }: ProductTileProps) {
  // "Stretched link": the product NAME is the one real link (so the spoken link name is exactly the visible name), and its
  // ::after covers the whole card, so the picture and the price tap through to the product too.
  return (
    <article className="group relative flex h-full flex-col rounded-[1.75rem] has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-cobalt-600">
      <div className="relative aspect-[4/5] overflow-hidden rounded-[1.75rem] bg-sand-100 ring-1 ring-sand-200">
        <div className="h-full w-full transition-transform duration-500 group-hover:scale-[1.03]">{media}</div>
        <div className="absolute start-3 top-3 flex flex-wrap gap-1.5">
          {sample && <PlaceholderTag />}
          {unique && <Badge tone="olive">اثر یگانه</Badge>}
          {extra}
        </div>
      </div>
      <div className="mt-3 space-y-0.5 px-1">
        {categoryName && <p className="text-xs font-medium text-teal-700">{categoryName}</p>}
        <h3 className="font-bold leading-7 text-bark-900">
          <Link href={href} className="outline-none after:absolute after:inset-0 after:content-['']">
            {name}
          </Link>
        </h3>
        <div className="pt-0.5">{price}</div>
      </div>
    </article>
  );
}

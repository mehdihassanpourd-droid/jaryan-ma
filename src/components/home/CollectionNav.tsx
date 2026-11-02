import Link from "next/link";

interface CollectionNavProps {
  items: ReadonlyArray<{ slug: string; name: string; href: string }>;
  /** Slug of the collection being viewed, if any. */
  current?: string;
}

/**
 * Collection navigation for listing pages: every collection of the catalogue (built from the data, so a new collection appears by
 * itself) as straight-edged links, 48px tall, scrolling sideways on a phone. The current one is filled.
 */
export function CollectionNav({ items, current }: CollectionNavProps) {
  return (
    <nav aria-label="مجموعه‌ها" className="-mx-5 mt-6 overflow-x-auto px-5 pb-1 sm:mx-0 sm:overflow-visible sm:px-0">
      <ul className="flex gap-2 sm:flex-wrap">
        <li className="shrink-0">
          <Link href="/#collections" className="flex min-h-12 items-center border-2 border-bark-900 px-4 text-sm font-black text-bark-900 hover:bg-bark-900 hover:text-ivory-50">
            همه مجموعه‌ها
          </Link>
        </li>
        {items.map((c) => {
          const active = c.slug === current;
          return (
            <li key={c.slug} className="shrink-0">
              <Link
                href={c.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-12 items-center border-2 px-4 text-sm font-black ${active ? "border-burgundy-600 bg-burgundy-600 text-ivory-50" : "border-bark-900 text-bark-900 hover:bg-bark-900 hover:text-ivory-50"}`}
              >
                {c.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

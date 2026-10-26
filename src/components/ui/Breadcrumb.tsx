import Link from "next/link";

export interface Crumb {
  name: string;
  href?: string;
}

/** Visible breadcrumb trail (the structured-data twin lives in `src/seo/jsonld.ts`). */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="مسیر صفحه" className="text-sm text-bark-600">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.name}-${i}`} className="flex items-center gap-2">
              {item.href && !last ? (
                <Link href={item.href} className="hover:text-bark-900 hover:underline">
                  {item.name}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "font-medium text-bark-900" : undefined}>
                  {item.name}
                </span>
              )}
              {!last && (
                <span aria-hidden="true" className="text-sand-400">
                  ‹
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

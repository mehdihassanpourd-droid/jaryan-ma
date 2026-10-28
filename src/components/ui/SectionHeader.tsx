import { Icon } from "./Icons";

interface SectionHeaderProps {
  id: string;
  title: string;
  /** Exhibition-style section number shown above the title (e.g. «۰۱»). */
  index?: string;
  /** Optional "see all" link shown on the opposite side of the title. */
  href?: string;
  linkLabel?: string;
  /** `light` for headings on dark or coloured fields. */
  tone?: "dark" | "light";
}

/** A heavy rule, a small section number and a very large title: the section opens like a wall text in a gallery. */
export function SectionHeader({ id, title, index, href, linkLabel = "همه", tone = "dark" }: SectionHeaderProps) {
  const light = tone === "light";
  return (
    <div className={`mb-8 border-t-4 pt-3 sm:mb-12 ${light ? "border-ivory-50" : "border-bark-900"}`}>
      {index && (
        <p aria-hidden="true" className={`text-sm font-black ${light ? "text-ivory-50" : "text-clay-600"}`}>
          {index}
        </p>
      )}
      <div className="flex items-end justify-between gap-4">
        <h2 id={id} className={`text-balance text-4xl font-black leading-[1.2] sm:text-6xl ${light ? "text-ivory-50" : "text-bark-900"}`}>
          {title}
        </h2>
        {href && (
          <a href={href} className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 text-sm font-bold ${light ? "border-ivory-50 text-ivory-50" : "border-bark-900 text-bark-900 hover:text-clay-600"}`}>
            {linkLabel}
            <Icon name="arrow" className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  );
}

import { Icon } from "./Icons";

interface SectionHeaderProps {
  id: string;
  title: string;
  /** Optional "see all" link shown on the opposite side of the title (the reference's «همه ←»). */
  href?: string;
  linkLabel?: string;
  /** `light` for headings on dark or coloured fields. */
  tone?: "dark" | "light";
}

export function SectionHeader({ id, title, href, linkLabel = "همه", tone = "dark" }: SectionHeaderProps) {
  const light = tone === "light";
  return (
    <div className="mb-5 flex items-end justify-between gap-4 sm:mb-8">
      <h2 id={id} className={`text-balance text-2xl font-black leading-snug sm:text-4xl ${light ? "text-ivory-50" : "text-bark-900"}`}>
        {title}
      </h2>
      {href && (
        <a href={href} className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm font-medium ${light ? "text-ivory-50 hover:text-sand-100" : "text-bark-700 hover:text-bark-900"}`}>
          {linkLabel}
          <Icon name="arrow" className="h-4 w-4" />
        </a>
      )}
    </div>
  );
}

import type { ReactNode } from "react";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  id?: string;
  /** Optional element (e.g. a placeholder tag) shown beside the eyebrow. */
  aside?: ReactNode;
}

export function SectionHeading({ eyebrow, title, description, id, aside }: SectionHeadingProps) {
  return (
    <div className="mb-10 max-w-2xl sm:mb-12">
      {(eyebrow || aside) && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {eyebrow && <p className="text-sm font-medium text-olive-700">{eyebrow}</p>}
          {aside}
        </div>
      )}
      <h2 id={id} className="text-2xl font-extrabold leading-snug text-bark-900 sm:text-4xl">
        {title}
      </h2>
      {description && <p className="mt-4 text-base text-bark-600 sm:text-lg">{description}</p>}
    </div>
  );
}

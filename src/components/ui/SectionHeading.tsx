interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  id?: string;
}

export function SectionHeading({ eyebrow, title, description, id }: SectionHeadingProps) {
  return (
    <div className="mb-10 max-w-2xl">
      {eyebrow && <p className="mb-2 text-sm font-medium text-olive-700">{eyebrow}</p>}
      <h2 id={id} className="text-2xl font-bold text-bark-900 sm:text-3xl">
        {title}
      </h2>
      {description && <p className="mt-3 text-bark-600">{description}</p>}
    </div>
  );
}

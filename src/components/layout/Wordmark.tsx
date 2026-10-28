import { site } from "@/lib/site";

/** The brand mark: the name in the heaviest weight with a small vermilion square. Assistive technology gets the plain brand name. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-black leading-none tracking-tight ${className}`}>
      <span aria-hidden="true" className="inline-block h-[0.55em] w-[0.55em] bg-clay-600" />
      <span className="sr-only">{site.name}</span>
      <span aria-hidden="true">جریان ما</span>
    </span>
  );
}

import { site } from "@/lib/site";

/** The hand-lettered brand mark. The visible lettering joins «جریان‌ما»; assistive technology gets the plain brand name. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-script leading-none ${className}`}>
      <span className="sr-only">{site.name}</span>
      <span aria-hidden="true">جریان‌ما</span>
    </span>
  );
}

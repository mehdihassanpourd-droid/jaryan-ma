import { serializeJsonLd } from "./jsonld";

/**
 * The ONLY place in the site that injects raw markup. The payload is JSON produced by our own builders
 * (never HTML) and serialised by `serializeJsonLd`, which escapes `<`, `>` and `&` so product text can
 * never close the script element. Renders nothing when there is no data.
 */
export function JsonLd({ data }: { data: unknown | unknown[] | null }) {
  const items = (Array.isArray(data) ? data : [data]).filter((d) => d !== null && d !== undefined);
  return (
    <>
      {items.map((item, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(item) }} />
      ))}
    </>
  );
}

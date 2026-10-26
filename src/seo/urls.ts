/** Same rule as the backend's `slugSchema`: letters and digits of any script (Persian included), joined by single hyphens. */
export const SLUG_PATTERN = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;

export const isValidSlug = (slug: string): boolean => slug.length > 0 && slug.length <= 100 && SLUG_PATTERN.test(slug);

/** Percent-encoded, so Persian slugs are valid in `<loc>`, canonical links and JSON-LD. */
export const productPath = (slug: string) => `/products/${encodeURIComponent(slug)}`;
export const categoryPath = (slug: string) => `/category/${encodeURIComponent(slug)}`;

export function absoluteUrl(origin: string, path: string): string {
  return `${origin}${path === "/" ? "/" : path}`;
}

/** Next may hand route params over encoded or decoded depending on the version/runtime; accept both. */
export function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Makes an image URL absolute when it is a site-relative path; leaves absolute URLs alone; drops anything else. */
export function absoluteImageUrl(origin: string | null, url: string): string | null {
  if (/^https?:\/\//i.test(url)) return url;
  if (origin && url.startsWith("/")) return `${origin}${url}`;
  return null;
}

/** Build-time SEO settings, derived from environment variables. Nothing here is a secret. */
export interface SeoEnv {
  NEXT_PUBLIC_SITE_URL?: string;
  /** Explicit launch switch. Anything but "true" keeps the site closed to search engines. */
  SEO_ALLOW_INDEXING?: string;
  NODE_ENV?: string;
}

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|.*\.local)$/i;

/**
 * The public origin (`https://example.ir`, no path, no trailing slash) used for canonical URLs, structured
 * data and the sitemap. `null` when it is unknown: in production a missing or local address is NOT replaced by a
 * guess, because a wrong canonical URL is worse than none.
 */
export function resolveOrigin(raw: string | undefined, production: boolean): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (production && LOCAL_HOST.test(url.hostname)) return null;
  return url.origin;
}

export interface SeoSettings {
  origin: string | null;
  /** Search engines may crawl and index the site (robots.txt allows it and pages may be `index`). */
  indexing: boolean;
}

/**
 * Launching needs a REAL catalogue. With the launch switch on but only the built-in sample content available
 * (the catalogue variable is missing or mistyped, or the workflow does not pass it), the site must stay closed:
 * otherwise robots.txt would open up and a home page full of sample products would become indexable.
 */
export function effectiveSettings(settings: SeoSettings, source: "demo" | "snapshot"): SeoSettings {
  return { origin: settings.origin, indexing: settings.indexing && source === "snapshot" };
}

export function seoSettings(env: SeoEnv = process.env): SeoSettings {
  const production = env.NODE_ENV === "production";
  const origin = resolveOrigin(env.NEXT_PUBLIC_SITE_URL, production);
  return { origin, indexing: env.SEO_ALLOW_INDEXING === "true" && origin !== null };
}

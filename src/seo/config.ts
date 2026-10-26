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

export function seoSettings(env: SeoEnv = process.env): SeoSettings {
  const production = env.NODE_ENV === "production";
  const origin = resolveOrigin(env.NEXT_PUBLIC_SITE_URL, production);
  return { origin, indexing: env.SEO_ALLOW_INDEXING === "true" && origin !== null };
}

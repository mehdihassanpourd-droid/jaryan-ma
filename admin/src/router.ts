import { useEffect, useState } from "react";

/** Hash routing: no server-side route handling, works from a static file server and as an installed PWA. */
export interface Route {
  path: string;
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path = "", query = ""] = raw.split("?");
  return { path: path.startsWith("/") ? path : `/${path}`, params: new URLSearchParams(query) };
}

export function hrefFor(path: string, params?: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) if (value !== undefined && value !== null && value !== "") q.set(key, String(value));
  const text = q.toString();
  return `#${path}${text ? `?${text}` : ""}`;
}

export function navigate(path: string, params?: Record<string, string | number | undefined | null>, options: { replace?: boolean } = {}): void {
  const target = hrefFor(path, params);
  if (options.replace) window.location.replace(target);
  else window.location.hash = target.slice(1);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/** Same shape the API accepts for product ids. Ids come from the URL hash, so they are validated before they reach an API path (no `..`, no `/`, no `?`). */
export const isProductId = (value: string): boolean => /^[A-Za-z0-9-]{1,64}$/.test(value);

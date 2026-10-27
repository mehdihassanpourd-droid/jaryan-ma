import { readFile, realpath, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

/**
 * Serves the built admin PWA (dist/admin) at /admin/ from the SAME Node server as the API. Same origin means the
 * session cookie stays SameSite=Strict, no CORS is needed and the Origin check keeps working. It is a static file
 * server for a fixed set of file types, never a second backend, and nothing under /admin/ reads or writes data.
 */
export interface AdminUiOptions {
  /** Directory with the build output (index.html, assets/, sw.js, manifest, icons, fonts). */
  dir: string;
  /** Origin of the media bucket when it differs from this server (images are shown in the product screens). */
  mediaOrigin?: string | null;
}

export interface AdminUiResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer | null;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

/**
 * No inline script or style anywhere (the build produces external files only), so `unsafe-inline` is never needed:
 * an injected script, however it got there, cannot run. Images may come from this server, the media bucket and
 * `blob:` (local previews of photos before upload).
 */
export function adminContentSecurityPolicy(mediaOrigin?: string | null): string {
  const img = ["'self'", "blob:", "data:", ...(mediaOrigin ? [mediaOrigin] : [])].join(" ");
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src ${img}`,
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; ");
}

const BASE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};

export function createAdminUiHandler(options: AdminUiOptions) {
  const root = resolve(options.dir);
  const csp = adminContentSecurityPolicy(options.mediaOrigin);

  const reply = (status: number, type: string, extra: Record<string, string>, body: Buffer | null): AdminUiResponse => ({
    status,
    headers: { "content-type": type, ...BASE_HEADERS, "content-security-policy": csp, ...extra },
    body,
  });
  const notFound = () => reply(404, "text/plain; charset=utf-8", { "cache-control": "no-store" }, Buffer.from("Not found"));

  return async function handle(method: string, pathname: string): Promise<AdminUiResponse | null> {
    // The bare address of this server (what "open in browser" shows for a forwarded port) has no page of its own:
    // send people to the admin app instead of a 404.
    if (pathname === "/" && (method === "GET" || method === "HEAD")) return reply(302, "text/plain; charset=utf-8", { location: "/admin/", "cache-control": "no-store" }, null);
    if (pathname === "/admin") return reply(308, "text/plain; charset=utf-8", { location: "/admin/", "cache-control": "no-store" }, null);
    if (!pathname.startsWith("/admin/")) return null;
    if (method !== "GET" && method !== "HEAD") return reply(405, "text/plain; charset=utf-8", { allow: "GET, HEAD", "cache-control": "no-store" }, Buffer.from("Method not allowed"));

    let relative: string;
    try {
      relative = decodeURIComponent(pathname.slice("/admin/".length));
    } catch {
      return notFound();
    }
    if (relative === "") relative = "index.html";
    if (relative.includes("\0") || relative.includes("\\") || relative.split("/").some((part) => part === ".." || part === "." || part.startsWith("."))) return notFound();

    const type = TYPES[extname(relative).toLowerCase()];
    if (!type) return notFound();
    const file = resolve(join(root, relative));
    if (!file.startsWith(root + sep)) return notFound();

    let body: Buffer;
    try {
      // Follow symlinks before the containment check: a link inside the directory must not lead outside it.
      const real = await realpath(file);
      const realRoot = await realpath(root);
      if (!real.startsWith(realRoot + sep)) return notFound();
      if (!(await stat(real)).isFile()) return notFound();
      body = await readFile(real);
    } catch {
      return notFound();
    }

    const hashed = relative.startsWith("assets/");
    const extra: Record<string, string> = {
      // Hashed build files never change; everything else (index.html, sw.js, manifest) must be revalidated so a
      // new release reaches installed apps promptly.
      "cache-control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    };
    if (relative === "sw.js") extra["service-worker-allowed"] = "/admin/";
    return reply(200, type, extra, method === "HEAD" ? null : body);
  };
}

export type AdminUiHandler = ReturnType<typeof createAdminUiHandler>;

/**
 * Used when the admin UI is switched on but has not been built (`dist/` is git-ignored, so a fresh checkout has none).
 * Instead of an unexplained 404 it says exactly what is missing. Serves no files and touches no data.
 */
export function createUnbuiltAdminUiHandler(): AdminUiHandler {
  const text =
    "پنل مدیریت هنوز ساخته نشده است.\nAdmin UI is not built yet: run `npm run admin:build` (or start with `npm run api:dev`, which builds it), then reload.\n";
  return async (method, pathname) => {
    if (pathname !== "/" && pathname !== "/admin" && !pathname.startsWith("/admin/")) return null;
    return {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "retry-after": "30", ...BASE_HEADERS },
      body: method === "HEAD" ? null : Buffer.from(text),
    };
  };
}

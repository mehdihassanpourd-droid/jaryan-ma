import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";

const root = join(import.meta.dirname, "../..");

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".xml": "application/xml" };

/**
 * Builds the REAL static storefront (`npm run build`, the same `out/` Cloudflare Pages serves) with the given public
 * settings and returns a private copy of it, so several builds (e.g. with and without an order system) can coexist.
 */
export function buildStorefront(publicEnv: Record<string, string>): string {
  const env: NodeJS.ProcessEnv = { ...process.env, ...publicEnv };
  for (const name of ["NEXT_PUBLIC_SITE_URL", "CATALOG_SNAPSHOT_URL", "CATALOG_SNAPSHOT_DIR", ...["NEXT_PUBLIC_CATALOG_URL", "NEXT_PUBLIC_ORDER_API_URL"].filter((n) => !(n in publicEnv))]) delete env[name];
  execFileSync("npm", ["run", "build", "--silent"], { cwd: root, stdio: "pipe", env });
  const dir = mkdtempSync(join(tmpdir(), "jm-storefront-"));
  cpSync(join(root, "out"), dir, { recursive: true });
  return dir;
}

/** Serves a built site like Cloudflare Pages: `/product?slug=x` -> product.html, `/` -> index.html, unknown -> 404.html. */
export async function serveStatic(dir: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    const candidates = [path, `${path}.html`, join(path, "index.html")].map((p) => normalize(join(dir, p)));
    const file = candidates.find((f) => f.startsWith(dir) && existsSync(f) && statSync(f).isFile());
    const target = file ?? join(dir, "404.html");
    res.writeHead(file ? 200 : 404, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
    res.end(readFileSync(target));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return { server, url: `http://127.0.0.1:${port}` };
}

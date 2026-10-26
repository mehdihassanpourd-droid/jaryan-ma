// Builds the admin PWA to dist/admin (served by the API server at /admin/). No bundler beyond esbuild, no CDN.
//   node scripts/admin/build.mjs            production build (minified)
//   node scripts/admin/build.mjs --watch    rebuild on change (development)
import { build, context } from "esbuild";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "../..");
const out = join(root, "dist/admin");
const watch = process.argv.includes("--watch");

const common = {
  absWorkingDir: root,
  bundle: true,
  format: "esm",
  target: ["es2022", "chrome100", "safari15"],
  jsx: "automatic",
  alias: { "@": "./src" },
  legalComments: "none",
  logLevel: "warning",
  minify: !watch,
  sourcemap: false,
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
  loader: { ".woff2": "file", ".png": "file", ".svg": "file" },
};

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

async function assemble() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const result = await build({
    ...common,
    entryPoints: { app: "admin/src/main.tsx" },
    outdir: join(out, "assets"),
    entryNames: "[name]-[hash]",
    assetNames: "[name]-[hash]",
    metafile: true,
  });
  finish(result);
}

function finish(result) {
  const outputs = Object.keys(result.metafile.outputs).map((p) => p.replace(/\\/g, "/"));
  const js = outputs.find((p) => /assets\/app-[^/]+\.js$/.test(p));
  const css = outputs.find((p) => /assets\/app-[^/]+\.css$/.test(p));
  if (!js || !css) throw new Error("admin build: missing JS or CSS output");

  cpSync(join(root, "admin/public"), out, { recursive: true });
  const html = readFileSync(join(root, "admin/index.html"), "utf8").replace("{{JS}}", js.split("/").pop()).replace("{{CSS}}", css.split("/").pop());
  writeFileSync(join(out, "index.html"), html);

  // Precache list: the shell and everything it needs; the hash of all of it versions the cache.
  const shell = files(out)
    .map((f) => "/admin/" + relative(out, f).replace(/\\/g, "/"))
    .filter((p) => !p.endsWith("/sw.js") && !p.endsWith("/index.html"));
  shell.push("/admin/");
  // Versions the cache: any change to any shell file changes the hash, so old caches are dropped on activate.
  const hash = createHash("sha256");
  for (const f of files(out).sort()) hash.update(relative(out, f)).update(readFileSync(f));
  const version = hash.digest("hex").slice(0, 12);
  return buildSw(shell.sort(), version);
}

async function buildSw(precache, version) {
  await build({
    ...common,
    entryPoints: { sw: "admin/src/sw.ts" },
    outdir: out,
    entryNames: "[name]",
    define: { ...common.define, __PRECACHE__: JSON.stringify(precache), __VERSION__: JSON.stringify(version) },
  });
  const bytes = files(out).reduce((n, f) => n + statSync(f).size, 0);
  console.log(`admin build: ${precache.length} shell files, ${(bytes / 1024).toFixed(0)} KiB total, version ${version} -> ${relative(root, out)}`);
}

if (watch) {
  // Simple and robust: rebuild everything on change (the app is small).
  const ctx = await context({ ...common, entryPoints: { app: "admin/src/main.tsx" }, outdir: join(out, "assets"), entryNames: "[name]-[hash]", assetNames: "[name]-[hash]", metafile: true, plugins: [{ name: "assemble", setup(b) { b.onStart(() => { rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true }); }); b.onEnd((r) => { if (r.errors.length === 0) void finish(r).catch((e) => console.error(e)); }); } }] });
  await ctx.watch();
  console.log("admin build: watching for changes ...");
} else {
  await assemble();
  if (!existsSync(join(out, "index.html"))) throw new Error("admin build failed");
}

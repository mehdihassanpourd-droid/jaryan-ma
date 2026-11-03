// Computes which installed npm packages the bundled server actually needs at run time (the packages esbuild left external),
// and everything those need in turn, by walking package.json dependencies the way Node resolves them. Works entirely from the
// already-installed node_modules: no registry, no network. Used by build-package.mjs.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/** `@scope/name/sub/path` -> `@scope/name`; `pkg/sub` -> `pkg`. */
export function packageNameOf(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Finds `name` the way Node would from `fromDir`: <fromDir>/node_modules/name, then each parent's node_modules. */
export function resolvePackageDir(name, fromDir, root) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dir === root || dir === dirname(dir)) return null;
    dir = dirname(dir);
  }
}

/**
 * @param {string[]} names top-level package names the bundle imports
 * @param {{ root: string, exclude?: string[] }} options root = the project directory that contains node_modules
 * @returns {{ packages: Array<{ name: string, version: string, dir: string, rel: string }>, missing: string[] }}
 */
export function collectClosure(names, { root, exclude = [] }) {
  const seen = new Map(); // dir -> info
  const missing = [];
  const excluded = new Set(exclude);
  const visit = (name, fromDir, required) => {
    if (excluded.has(name)) return;
    const dir = resolvePackageDir(name, fromDir, root);
    if (!dir) {
      if (required) missing.push(name);
      return;
    }
    if (seen.has(dir)) return;
    const pkg = readJson(join(dir, "package.json"));
    seen.set(dir, { name: pkg.name ?? name, version: pkg.version ?? "0.0.0", dir, rel: relative(root, dir).split(sep).join("/") });
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir, true);
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) visit(dep, dir, false);
    for (const [dep] of Object.entries(pkg.peerDependencies ?? {})) if (!pkg.peerDependenciesMeta?.[dep]?.optional) visit(dep, dir, false);
  };
  for (const name of names) visit(name, root, true);
  const packages = [...seen.values()].sort((a, b) => a.rel.localeCompare(b.rel));
  return { packages, missing: [...new Set(missing)].sort() };
}

/** Package names imported (externally) by an esbuild metafile, ignoring node: built-ins. */
export function externalPackagesFromMetafile(metafile) {
  const names = new Set();
  for (const output of Object.values(metafile.outputs)) {
    for (const imp of output.imports ?? []) {
      if (imp.external && !imp.path.startsWith("node:") && !imp.path.startsWith(".") && !imp.path.startsWith("/")) names.add(packageNameOf(imp.path));
    }
  }
  return [...names].sort();
}

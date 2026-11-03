#!/usr/bin/env node
// Builds the offline production release package (see docs/deploy/OFFLINE-DEPLOY-FA.md).
//
//   node scripts/release/build-package.mjs --version 2026.11.1 --site-url https://shop.example.ir \
//        --api-url https://api.example.ir --catalog-url https://media.example.ir [--out release] [--reuse-build] [--no-node]
//
// Needs the project's dev dependencies and (unless --reuse-build) network access to nothing but the already installed
// node_modules: the BUILD runs where `npm ci` was done (CI or a developer machine); the resulting package needs no network.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { collectClosure, externalPackagesFromMetafile } from "./closure.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv) {
  const opts = { out: "release", reuseBuild: false, bundleNode: true, platform: "linux-x64" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--version") opts.version = next();
    else if (a === "--site-url") opts.siteUrl = next();
    else if (a === "--api-url") opts.apiUrl = next();
    else if (a === "--catalog-url") opts.catalogUrl = next();
    else if (a === "--out") opts.out = next();
    else if (a === "--reuse-build") opts.reuseBuild = true;
    else if (a === "--no-node") opts.bundleNode = false;
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
};
const git = (...args) => {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, name.name);
    if (name.isDirectory()) walk(full, out);
    else if (name.isFile() || name.isSymbolicLink()) out.push(full);
  }
  return out;
}

const httpsUrl = (value, label, allowEmpty = false) => {
  if (!value && allowEmpty) return "";
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`${label} must be a full URL`);
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && /^(localhost|127\.|10\.|192\.168\.)/.test(u.hostname))) throw new Error(`${label} must be https`);
  return value.replace(/\/+$/, "");
};

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log("node scripts/release/build-package.mjs --version V --site-url URL --api-url URL --catalog-url URL [--out DIR] [--reuse-build] [--no-node]");
    return null;
  }
  const commit = git("rev-parse", "HEAD") || "unknown";
  const shortCommit = commit.slice(0, 7);
  const version = opts.version ?? `0.0.0-${shortCommit}`;
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,40}$/.test(version)) throw new Error("--version may contain only letters, digits, . _ -");
  const siteUrl = httpsUrl(opts.siteUrl, "--site-url");
  const apiUrl = httpsUrl(opts.apiUrl, "--api-url");
  const catalogUrl = httpsUrl(opts.catalogUrl, "--catalog-url");
  const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? git("log", "-1", "--format=%ct") ?? 0) || 0;

  const outDir = resolve(ROOT, opts.out);
  const name = `jaryan-ma-${version}-${opts.platform}`;
  const stage = join(outDir, ".stage", name);
  rmSync(join(outDir, ".stage"), { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  // 1. builds ------------------------------------------------------------------------------------------------
  if (!opts.reuseBuild) {
    run("npm", ["run", "api:build", "--", "--metafile=dist/server-meta.json"]);
    run("npm", ["run", "admin:build"]);
    // The storefront's public addresses are fixed at build time (NEXT_PUBLIC_*): the package is built for one set of domains.
    run("npm", ["run", "build"], { NEXT_PUBLIC_SITE_URL: siteUrl, NEXT_PUBLIC_ORDER_API_URL: apiUrl, NEXT_PUBLIC_CATALOG_URL: catalogUrl });
  }
  for (const needed of ["dist/server/main.mjs", "dist/server/cli/ops.mjs", "dist/server/cli/migrate.mjs", "dist/server-meta.json", "dist/admin/index.html", "out/index.html"]) {
    if (!existsSync(join(ROOT, needed))) throw new Error(`missing build output ${needed} (run without --reuse-build)`);
  }

  // 2. assemble ----------------------------------------------------------------------------------------------
  const app = join(stage, "app");
  cpSync(join(ROOT, "dist/server"), join(app, "dist/server"), { recursive: true });
  cpSync(join(ROOT, "dist/admin"), join(app, "dist/admin"), { recursive: true });
  cpSync(join(ROOT, "prisma/migrations"), join(app, "prisma/migrations"), { recursive: true });
  copyFileSync(join(ROOT, "prisma/schema.prisma"), join(app, "prisma/schema.prisma"));
  cpSync(join(ROOT, "out"), join(stage, "storefront"), { recursive: true });
  cpSync(join(ROOT, "deploy"), join(stage, "deploy"), { recursive: true });
  cpSync(join(ROOT, "ops/systemd"), join(stage, "ops/systemd"), { recursive: true });
  cpSync(join(ROOT, "scripts/maintenance"), join(stage, "scripts/maintenance"), { recursive: true });
  mkdirSync(join(stage, "docs"), { recursive: true });
  for (const doc of ["docs/deploy", "docs/maintenance"]) if (existsSync(join(ROOT, doc))) cpSync(join(ROOT, doc), join(stage, doc), { recursive: true });
  cpSync(join(ROOT, "deploy/bin"), join(stage, "bin"), { recursive: true });

  // 3. production dependencies: only what the bundle imports at run time, plus what those need (no dev tools, no Next.js) -----------
  const meta = JSON.parse(readFileSync(join(ROOT, "dist/server-meta.json"), "utf8"));
  const wanted = externalPackagesFromMetafile(meta);
  // The embedded development database is only imported on the development path (dynamic import behind a config switch).
  const DEV_ONLY = ["@electric-sql/pglite", "@electric-sql/pglite-socket"];
  const closure = collectClosure(wanted, { root: ROOT, exclude: DEV_ONLY });
  if (closure.missing.length > 0) throw new Error(`packages needed at run time are not installed: ${closure.missing.join(", ")} (run npm ci)`);
  for (const pkg of closure.packages) {
    cpSync(pkg.dir, join(app, "node_modules", pkg.rel.replace(/^node_modules\//, "")), {
      recursive: true,
      filter: (src) => {
        if (/\.(map|md|markdown)$/i.test(src) || /[\\/](test|tests|__tests__|\.github|docs?)$/i.test(src)) return false;
        // Prisma ships query compilers for every database and TypeScript typings; only PostgreSQL JavaScript is used here.
        if (/@prisma[\\/]client[\\/]runtime[\\/][^\\/]+$/.test(src) && (/(sqlite|sqlserver|mysql|cockroach|mongodb)/i.test(src) || /\.d\.[cm]?ts$/.test(src))) return false;
        return true;
      },
    });
  }
  writeFileSync(join(app, "package.json"), JSON.stringify({ name: "jaryan-ma-runtime", private: true, type: "module", version, engines: { node: ">=22" } }, null, 2) + "\n");

  // 4. runtime ---------------------------------------------------------------------------------------------------
  let nodeInfo = null;
  if (opts.bundleNode) {
    mkdirSync(join(stage, "runtime"), { recursive: true });
    copyFileSync(process.execPath, join(stage, "runtime/node"));
    chmodSync(join(stage, "runtime/node"), 0o755);
    nodeInfo = { version: process.version, sha256: sha256(join(stage, "runtime/node")), source: "the Node.js binary that ran this build" };
  }

  // 5. metadata ----------------------------------------------------------------------------------------------------
  const migrations = readdirSync(join(app, "prisma/migrations"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const release = {
    name: "jaryan-ma",
    version,
    platform: opts.platform,
    commit,
    builtAt: new Date(epoch * 1000).toISOString(),
    node: nodeInfo,
    publicUrls: { site: siteUrl, api: apiUrl, catalog: catalogUrl },
    migrations: migrations.map((m) => ({ name: m, sha256: createHash("sha256").update(readFileSync(join(app, "prisma/migrations", m, "migration.sql"))).digest("hex") })),
    runtimeDependencies: closure.packages.map((p) => `${p.name}@${p.version}`),
    lockfileSha256: sha256(join(ROOT, "package-lock.json")),
    needsNetworkToInstall: false,
  };
  writeFileSync(join(stage, "RELEASE.json"), JSON.stringify(release, null, 2) + "\n");

  // 6. checksums over every file, then a deterministic archive ------------------------------------------------------------
  const files = walk(stage).map((f) => relative(stage, f).split(sep).join("/")).sort();
  writeFileSync(join(stage, "SHA256SUMS"), files.map((f) => `${sha256(join(stage, f))}  ${f}`).join("\n") + "\n");
  for (const f of walk(stage)) {
    const mode = statSync(f).mode & 0o111 || /\.sh$|[\\/]bin[\\/]/.test(f) ? 0o755 : 0o644;
    chmodSync(f, mode);
  }
  mkdirSync(outDir, { recursive: true });
  const archive = join(outDir, `${name}.tar.xz`);
  rmSync(archive, { force: true });
  const tar = spawnSync("bash", ["-c", `cd "${join(outDir, ".stage")}" && tar --sort=name --mtime=@${epoch} --owner=0 --group=0 --numeric-owner --format=gnu -cf - "${name}" | xz -T1 ${process.env.JM_XZ_LEVEL ?? "-9e"} > "${archive}"`], { stdio: "inherit" });
  if (tar.status !== 0) throw new Error("creating the archive failed");
  const archiveSha = sha256(archive);
  writeFileSync(`${archive}.sha256`, `${archiveSha}  ${name}.tar.xz\n`);
  rmSync(join(outDir, ".stage"), { recursive: true, force: true });

  const size = statSync(archive).size;
  console.log(JSON.stringify({ archive: relative(ROOT, archive), sha256: archiveSha, bytes: size, files: files.length, runtimePackages: closure.packages.length }, null, 2));
  return { archive, sha256: archiveSha, bytes: size, release };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

// One command: build the static site against a snapshot produced by the REAL backend stack, in both modes, and audit the HTML.
//   npm run seo:verify          (overwrites ./out; run `npm run build` again afterwards for a normal build)
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGIN = "https://seo-check.example";
const dir = mkdtempSync(join(tmpdir(), "jm-seo-snapshot-"));
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    process.exit(r.status ?? 1);
  }
};

// A fresh checkout has no generated Prisma client yet (it is gitignored).
run("npm", ["run", "db:generate", "--silent"]);

console.log("1/3 Creating a catalogue through the real backend (PostgreSQL via Prisma) and publishing its snapshot ...");
run("npx", ["tsx", "scripts/seo/generate-fixture.ts", dir]);

console.log("\n2/3 Pre-launch build with sample content: must be fully closed to search engines ...");
rmSync("out", { recursive: true, force: true });
run("npm", ["run", "build", "--silent"], { NEXT_PUBLIC_SITE_URL: ORIGIN, CATALOG_SNAPSHOT_DIR: "", SEO_ALLOW_INDEXING: "" });
run("node", ["scripts/seo/verify-build.mjs", "out", ORIGIN]);

console.log("\n2b/3 Launch switch ON but no real catalogue (misconfiguration): must STILL be fully closed ...");
rmSync("out", { recursive: true, force: true });
run("npm", ["run", "build", "--silent"], { NEXT_PUBLIC_SITE_URL: ORIGIN, CATALOG_SNAPSHOT_DIR: "", SEO_ALLOW_INDEXING: "true" });
run("node", ["scripts/seo/verify-build.mjs", "out", ORIGIN]);

console.log("\n3/3 Launched build with the real snapshot: indexable products, sitemap, canonicals, structured data ...");
rmSync("out", { recursive: true, force: true });
run("npm", ["run", "build", "--silent"], { NEXT_PUBLIC_SITE_URL: ORIGIN, CATALOG_SNAPSHOT_DIR: dir, SEO_ALLOW_INDEXING: "true" });
run("node", ["scripts/seo/verify-build.mjs", "out", ORIGIN, "--indexing"]);

rmSync(dir, { recursive: true, force: true });
console.log("\nAll SEO checks passed.");

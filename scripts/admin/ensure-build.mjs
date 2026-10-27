// Builds the admin app only when it is missing (`dist/` is git-ignored, so a fresh checkout has none).
// Used by `npm run api:dev` so the admin page is never a 404 just because nobody ran the build.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "../..");
const dir = process.env.ADMIN_UI_DIR ?? "dist/admin";
if (process.env.ADMIN_UI_ENABLED === "false" || existsSync(join(root, dir, "index.html"))) process.exit(0);

console.log("admin app not built yet: building it once (npm run admin:build)…");
const result = spawnSync(process.execPath, [join(root, "scripts/admin/build.mjs")], { stdio: "inherit", cwd: root });
process.exit(result.status ?? 1);

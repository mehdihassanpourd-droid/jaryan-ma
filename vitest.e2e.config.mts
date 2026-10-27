import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Browser end-to-end tests of the admin PWA against the real server. Run with `npm run admin:e2e` (needs `npm run admin:build`).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["admin/e2e/**/*.e2e.ts"], testTimeout: 60_000, hookTimeout: 180_000, fileParallelism: false },
});

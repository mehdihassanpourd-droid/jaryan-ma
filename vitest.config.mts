import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // ops/connectivity-probe is a stand-alone package with its own node:test suite (its own CI job)
  test: { exclude: [...configDefaults.exclude, "ops/connectivity-probe/**"] },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});

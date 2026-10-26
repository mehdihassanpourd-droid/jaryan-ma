import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // The admin app is a plain React SPA served by the API server, not a Next.js page: next/image does not apply.
  { files: ["admin/**/*.{ts,tsx}"], rules: { "@next/next/no-img-element": "off" } },
  globalIgnores([".next/**", "out/**", "build/**", "dist/**", ".data/**", "next-env.d.ts", "src/generated/**"]),
]);

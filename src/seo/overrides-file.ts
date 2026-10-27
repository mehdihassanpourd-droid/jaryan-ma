import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NO_OVERRIDES, parseOverrides, type SeoOverrides } from "./overrides";

export * from "./overrides";

/** Reads `seo/overrides.json` from the project root; a missing file means "no overrides". */
export function loadOverrides(root = process.cwd()): SeoOverrides {
  try {
    return parseOverrides(readFileSync(join(root, "seo", "overrides.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return NO_OVERRIDES;
    throw error;
  }
}

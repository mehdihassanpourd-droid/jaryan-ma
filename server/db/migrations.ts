import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../prisma/migrations/", import.meta.url));

export interface Migration {
  name: string;
  sql: string;
}

/** The Prisma migration files, in order. Production applies them with `prisma migrate deploy`. */
export function readMigrations(dir = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({ name, sql: readFileSync(`${dir}${name}/migration.sql`, "utf8") }));
}

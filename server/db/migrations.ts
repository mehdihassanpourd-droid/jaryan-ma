import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the migration files are. From source (`server/db/`) and from the bundled server (`dist/server/`) the repository /
 * release root is two levels up; from the bundled CLIs (`dist/server/cli/`) it is three. `MIGRATIONS_DIR` overrides all of it.
 * (Looking in only one place made the bundled `ops` CLI silently skip the "migrations applied" check.)
 */
export function findMigrationsDir(start: string = dirname(fileURLToPath(import.meta.url)), env: Record<string, string | undefined> = process.env): string {
  if (env.MIGRATIONS_DIR) return env.MIGRATIONS_DIR.endsWith("/") ? env.MIGRATIONS_DIR : `${env.MIGRATIONS_DIR}/`;
  for (const up of ["../..", "../../..", "../../../.."]) {
    const candidate = join(start, up, "prisma", "migrations");
    if (existsSync(join(candidate, "migration_lock.toml"))) return `${candidate}/`;
  }
  return `${join(start, "../..", "prisma", "migrations")}/`;
}

export interface Migration {
  name: string;
  sql: string;
}

/** The Prisma migration files, in order. Production applies them with `prisma migrate deploy`. */
export function readMigrations(dir = findMigrationsDir()): Migration[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({ name, sql: readFileSync(`${dir}${name}/migration.sql`, "utf8") }));
}

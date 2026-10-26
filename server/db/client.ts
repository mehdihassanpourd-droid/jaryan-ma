import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";

export type Db = PrismaClient;

export interface DbOptions {
  /** Max pool size. Embedded PostgreSQL (dev/tests) is happiest with a handful of connections. */
  maxConnections?: number;
  /** PostgreSQL schema (search_path). Tests use one schema per test file against a shared server. */
  schema?: string;
}

/** Prisma client over the standard `pg` driver: works with any PostgreSQL (self-hosted, managed, embedded). */
export function createDb(connectionString: string, options: DbOptions = {}): Db {
  const adapter = new PrismaPg(
    { connectionString, max: options.maxConnections ?? 10, ssl: sslFor(connectionString) },
    options.schema ? { schema: options.schema } : undefined,
  );
  return new PrismaClient({ adapter });
}

/** TLS only when the URL asks for it (`sslmode=require` etc.); local/embedded servers have none. */
function sslFor(connectionString: string): boolean | { rejectUnauthorized: boolean } | undefined {
  const mode = new URL(connectionString).searchParams.get("sslmode");
  if (!mode || mode === "disable") return false;
  if (mode === "verify-full" || mode === "verify-ca") return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

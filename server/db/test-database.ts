import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { createDb, type Db } from "./client";
import { EMBEDDED_POOL, startEmbeddedPostgres } from "./embedded";
import { readMigrations } from "./migrations";

export interface TestDatabase {
  db: Db;
  /** PostgreSQL schema holding the test tables (raw SQL is not scoped by Prisma's schema option; qualify explicitly). */
  schema: string;
  /** Removes all rows (keeps the schema) so each test starts clean. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Database for tests. By default an in-process embedded PostgreSQL (no services, runs anywhere,
 * including CI). Set TEST_DATABASE_URL to run the very same tests against a real PostgreSQL server:
 * each test file then gets its own throw-away schema.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const external = process.env.TEST_DATABASE_URL;
  if (!external) {
    const embedded = await startEmbeddedPostgres();
    const db = createDb(embedded.url, EMBEDDED_POOL);
    return finish(db, "public", async () => {
      await db.$disconnect();
      await embedded.stop();
    });
  }

  const schema = `test_${randomBytes(6).toString("hex")}`;
  const admin = new Client({ connectionString: external });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path TO "${schema}"`);
  for (const migration of readMigrations()) await admin.query(migration.sql);
  const db = createDb(external, { maxConnections: 4, schema });
  return finish(db, schema, async () => {
    await db.$disconnect();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });
}

function finish(db: Db, schema: string, close: () => Promise<void>): TestDatabase {
  return {
    db,
    schema,
    async reset() {
      // Discover tables instead of listing them, so new models never need a helper change. Raw SQL is not covered
      // by Prisma's schema option, so tables are schema-qualified explicitly. RESTART IDENTITY makes ticket/order
      // numbers deterministic. Tables starting with "_" (migration bookkeeping) are left alone.
      const tables = await db.$queryRawUnsafe<Array<{ tablename: string }>>(
        `SELECT tablename FROM pg_tables WHERE schemaname = '${schema}' AND tablename NOT LIKE '\\_%'`,
      );
      if (tables.length === 0) return;
      await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${schema}"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
    },
    close,
  };
}

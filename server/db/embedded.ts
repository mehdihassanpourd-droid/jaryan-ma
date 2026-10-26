import { mkdirSync } from "node:fs";
import { readMigrations } from "./migrations";

/**
 * Embedded PostgreSQL (PGlite, WebAssembly) for local development and tests: real PostgreSQL
 * semantics with nothing to install and no external service. NEVER used in production, where
 * `DATABASE_URL` must point to a real PostgreSQL server.
 */
export interface EmbeddedPostgres {
  /** Standard connection string; works with `pg` and Prisma. */
  url: string;
  stop(): Promise<void>;
}

export async function startEmbeddedPostgres(options: { dataDir?: string } = {}): Promise<EmbeddedPostgres> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { PGLiteSocketServer } = await import("@electric-sql/pglite-socket");

  if (options.dataDir) mkdirSync(options.dataDir, { recursive: true });
  const db = await PGlite.create(options.dataDir);

  // Track applied migrations so a persistent dev database can be upgraded in place.
  await db.exec('CREATE TABLE IF NOT EXISTS "_dev_migrations" (name TEXT PRIMARY KEY)');
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM "_dev_migrations"')).rows.map((r) => r.name));
  for (const migration of readMigrations()) {
    if (done.has(migration.name)) continue;
    await db.exec(migration.sql);
    await db.query('INSERT INTO "_dev_migrations" (name) VALUES ($1)', [migration.name]);
  }

  const server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 16 });
  await server.start();
  const address = (server as unknown as { server: { address(): { port: number } } }).server.address();
  return {
    url: `postgresql://postgres:postgres@127.0.0.1:${address.port}/postgres`,
    async stop() {
      await server.stop();
      await db.close();
    },
  };
}

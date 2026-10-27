import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./client";
import { EMBEDDED_POOL, startEmbeddedPostgres, type EmbeddedPostgres } from "./embedded";

/**
 * The embedded development database (PGlite) is one PostgreSQL session behind a socket. With several pool connections,
 * overlapping transactions collide (Prisma P2039) and requests fail intermittently with HTTP 500: it made a browser test
 * flaky on CI and could do the same to `npm run api:dev`. The server therefore uses EMBEDDED_POOL (one connection).
 */
let embedded: EmbeddedPostgres;
let single: Db;

beforeAll(async () => {
  embedded = await startEmbeddedPostgres();
  single = createDb(embedded.url, EMBEDDED_POOL);
}, 60_000);
afterAll(async () => {
  await single.$disconnect();
  await embedded.stop();
});

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Interactive transactions racing plain queries: the shape of "background sync during the next page load". */
async function hammer(db: Db, rounds: number): Promise<{ failures: number; codes: string[] }> {
  const codes: string[] = [];
  const attempt = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      codes.push((error as { code?: string }).code ?? (error as Error).name);
    }
  };
  const tasks: Array<Promise<void>> = [];
  for (let i = 0; i < rounds; i++) {
    tasks.push(attempt(() => db.$transaction(async (tx) => { await tx.$queryRaw`SELECT 1`; await pause(5); await tx.$queryRaw`SELECT 2`; })));
    tasks.push(attempt(() => db.$queryRaw`SELECT 3`));
    tasks.push(attempt(() => db.$transaction([db.$queryRaw`SELECT 4`, db.$queryRaw`SELECT 5`])));
  }
  await Promise.all(tasks);
  return { failures: codes.length, codes };
}

describe("embedded development database", () => {
  it("uses a single connection with a bounded wait", () => {
    expect(EMBEDDED_POOL).toEqual({ maxConnections: 1, connectionTimeoutMs: 30_000 });
  });

  it("survives many overlapping transactions and queries with no failure", async () => {
    const result = await hammer(single, 60);
    expect(result).toEqual({ failures: 0, codes: [] });
  }, 60_000);
});

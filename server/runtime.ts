import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApi } from "./api";
import { AuthService, DEFAULT_AUTH_SETTINGS } from "./auth/auth-service";
import { ScryptHasher } from "./auth/password";
import { PrismaAdminStore } from "./auth/prisma-store";
import { RateLimiter } from "./auth/rate-limit";
import { SecretBox } from "./auth/secret-box";
import { SessionAuthenticator } from "./auth/session";
import { PrismaCatalogRepository } from "./catalog/prisma-repository";
import { CatalogService } from "./catalog/service";
import { SnapshotPublisher } from "./catalog/snapshot-publisher";
import type { Config } from "./config";
import { createDb, type Db } from "./db/client";
import { startEmbeddedPostgres, type EmbeddedPostgres } from "./db/embedded";
import { ensureDefaultVendor } from "./db/vendor";
import { LocalDiskStorage } from "./storage/local-disk";
import { createS3Client, S3Storage } from "./storage/s3";
import type { ObjectStorage } from "../src/domain/product/ports";

export type Logger = (level: "info" | "warn" | "error", event: string, detail?: Record<string, unknown>) => void;

/** One JSON object per line: easy to ship to any log collector. Never pass secrets in `detail`. */
export const jsonLogger: Logger = (level, event, detail) => {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, event, ...detail }));
};

export interface Database {
  db: Db;
  embedded: boolean;
  stop(): Promise<void>;
}

/** Production: the PostgreSQL in DATABASE_URL. Development without DATABASE_URL: embedded PostgreSQL. */
export async function openDatabase(config: Config, log: Logger = jsonLogger): Promise<Database> {
  let embedded: EmbeddedPostgres | null = null;
  let url = config.databaseUrl;
  if (!url) {
    if (config.production) throw new Error("DATABASE_URL is required in production");
    embedded = await startEmbeddedPostgres({ dataDir: join(config.devDataDir, "pglite") });
    url = embedded.url;
    log("warn", "embedded_postgres", { note: "development only; set DATABASE_URL to use a real PostgreSQL" });
  }
  const db = createDb(url, { maxConnections: embedded ? 4 : 10 });
  return {
    db,
    embedded: embedded !== null,
    async stop() {
      await db.$disconnect();
      await embedded?.stop();
    },
  };
}

/** Production key comes from the environment; development generates one once and keeps it in .data/. */
export function resolveSecretBox(config: Config): SecretBox {
  if (config.encryptionKey) return SecretBox.fromBase64(config.encryptionKey);
  if (config.production) throw new Error("APP_ENCRYPTION_KEY is required in production");
  mkdirSync(config.devDataDir, { recursive: true });
  const file = join(config.devDataDir, "dev-encryption.key");
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  return SecretBox.fromBase64(readFileSync(file, "utf8").trim());
}

export function createAuthServices(config: Config, db: Db) {
  const store = new PrismaAdminStore(db);
  const settings = { ...DEFAULT_AUTH_SETTINGS, sessionAbsoluteMs: config.sessionAbsoluteHours * 3600_000, requireTotp: config.requireTotp };
  const service = new AuthService(store, new ScryptHasher({ logN: config.scryptLogN, r: 8, p: 1 }), resolveSecretBox(config), new RateLimiter(), settings);
  const cookie = { name: config.cookieSecure ? "__Host-jm_session" : "jm_session", secure: config.cookieSecure };
  const authenticator = new SessionAuthenticator(store, cookie, { idleMs: config.sessionIdleMinutes * 60_000, absoluteMs: settings.sessionAbsoluteMs });
  return { store, service, cookie, authenticator, settings };
}

export interface Runtime {
  handle: (request: Request) => Promise<Response>;
  media?: LocalDiskStorage;
  shutdown(): Promise<void>;
}

export async function createRuntime(config: Config, log: Logger = jsonLogger): Promise<Runtime> {
  const database = await openDatabase(config, log);
  const { db } = database;
  const vendorId = await ensureDefaultVendor(db);
  const repo = new PrismaCatalogRepository(db, vendorId);

  let storage: ObjectStorage;
  let media: LocalDiskStorage | undefined;
  if (config.storage.driver === "s3") {
    const s3 = config.storage.s3;
    storage = new S3Storage(createS3Client(s3), s3.bucket);
  } else {
    media = new LocalDiskStorage(join(config.devDataDir, "media"));
    storage = media;
    log("warn", "local_media_storage", { note: "development only; configure STORAGE_DRIVER=s3 for production" });
  }

  const auth = createAuthServices(config, db);
  if (config.devAdmin && !(await auth.store.findByEmail(config.devAdmin.email.toLowerCase()))) {
    await auth.service.createAccount({ email: config.devAdmin.email, password: config.devAdmin.password, role: "owner", totpSecret: null });
    log("warn", "dev_admin_created", { email: config.devAdmin.email });
  }

  const pending = new Set<Promise<unknown>>();
  const handle = createApi({
    catalog: new CatalogService(repo),
    storage,
    publisher: new SnapshotPublisher(repo, storage, config.publicMediaUrl ?? ""),
    auth: auth.service,
    authenticator: auth.authenticator,
    cookie: auth.cookie,
    sessionMaxAgeSeconds: config.sessionAbsoluteHours * 3600,
    adminOrigins: config.adminOrigins,
    importChunkMax: config.importChunkMax,
    background: (task) => {
      pending.add(task);
      void task.finally(() => pending.delete(task));
    },
    log: (event, detail) => log("error", event, detail),
  });

  const purge = setInterval(() => void auth.store.purgeExpired(new Date()).catch(() => undefined), 3600_000);
  purge.unref();

  return {
    handle,
    media,
    async shutdown() {
      clearInterval(purge);
      await Promise.allSettled([...pending]);
      await database.stop();
    },
  };
}

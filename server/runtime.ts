import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { FirstRunSetup } from "./auth/first-run-setup";
import { createAdminUiHandler, createUnbuiltAdminUiHandler, type AdminUiHandler } from "./admin-ui";
import { createApi } from "./api";
import { DEFAULT_OTP_POLICY } from "../src/domain/customer/otp-policy";
import { createCustomerApi, isCustomerApiPath } from "./customer-api";
import { createPlatformServices } from "./services";
import { ConsoleSmsProvider, DisabledSmsProvider, HttpSmsProvider, type SmsProvider } from "./sms/provider";
import type { CheckResult } from "../src/domain/maintenance/health";
import type { SecurityFacts } from "../src/domain/maintenance/security-checks";
import { readMigrations } from "./db/migrations";
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
import { EMBEDDED_POOL, startEmbeddedPostgres, type EmbeddedPostgres } from "./db/embedded";
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
  const db = createDb(url, embedded ? EMBEDDED_POOL : { maxConnections: 10 });
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
export function resolveMasterKey(config: Config): Buffer {
  if (config.encryptionKey) return Buffer.from(config.encryptionKey, "base64");
  if (config.production) throw new Error("APP_ENCRYPTION_KEY is required in production");
  mkdirSync(config.devDataDir, { recursive: true });
  const file = join(config.devDataDir, "dev-encryption.key");
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  return Buffer.from(readFileSync(file, "utf8").trim(), "base64");
}

export const resolveSecretBox = (config: Config): SecretBox => new SecretBox(resolveMasterKey(config));

export function createAuthServices(config: Config, db: Db) {
  const store = new PrismaAdminStore(db);
  const settings = { ...DEFAULT_AUTH_SETTINGS, sessionAbsoluteMs: config.sessionAbsoluteHours * 3600_000, requireTotp: config.requireTotp };
  const service = new AuthService(store, new ScryptHasher({ logN: config.scryptLogN, r: 8, p: 1 }), resolveSecretBox(config), new RateLimiter(), settings);
  const cookie = { name: config.cookieSecure ? "__Host-jm_session" : "jm_session", secure: config.cookieSecure };
  const authenticator = new SessionAuthenticator(store, cookie, { idleMs: config.sessionIdleMinutes * 60_000, absoluteMs: settings.sessionAbsoluteMs });
  return { store, service, cookie, authenticator, settings };
}

export function createStorage(config: Config, log: Logger = jsonLogger): { storage: ObjectStorage; media?: LocalDiskStorage } {
  if (config.storage.driver === "s3") {
    const s3 = config.storage.s3;
    return { storage: new S3Storage(createS3Client(s3), s3.bucket) };
  }
  const media = new LocalDiskStorage(join(config.devDataDir, "media"));
  log("warn", "local_media_storage", { note: "development only; configure STORAGE_DRIVER=s3 for production" });
  return { storage: media, media };
}

export function createSmsProvider(config: Config): SmsProvider {
  const sms = config.sms;
  if (sms.provider === "console") return new ConsoleSmsProvider();
  if (sms.provider === "http" && sms.http) {
    const headers: Record<string, string> = sms.http.authHeader ? { [sms.http.authHeaderName]: sms.http.authHeader } : {};
    return new HttpSmsProvider({ url: sms.http.url, headers, bodyTemplate: sms.http.bodyTemplate, idField: sms.http.idField ?? undefined });
  }
  return new DisabledSmsProvider();
}

/** The facts the security review needs; never the secret values themselves. */
export function securityFacts(config: Config, embedded: boolean): SecurityFacts {
  return {
    production: config.production,
    encryptionKeyConfigured: config.encryptionKey !== null,
    cookieSecure: config.cookieSecure,
    requireTotp: config.requireTotp,
    adminOrigins: config.adminOrigins.split(",").map((o) => o.trim()).filter(Boolean),
    storageDriver: config.storage.driver,
    databaseIsEmbedded: embedded,
    trustProxy: config.trustProxy,
    customerAccountsEnabled: config.customerAccountsEnabled,
    smsProvider: config.sms.provider === "disabled" ? "disabled" : config.sms.provider,
    publicMediaUrl: config.publicMediaUrl,
    devAdminConfigured: config.devAdmin !== null,
  };
}

/** Every migration file is recorded as finished in Prisma's history table. */
export async function checkMigrations(db: Db, production: boolean): Promise<CheckResult> {
  let rows: Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>;
  try {
    rows = await db.$queryRaw`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
  } catch {
    return production
      ? { name: "migrations", status: "fail", message: "migration history table not found: run `prisma migrate deploy`" }
      : { name: "migrations", status: "ok", message: "development database (migration history not tracked)" };
  }
  if (rows.some((r) => r.finished_at === null && r.rolled_back_at === null)) return { name: "migrations", status: "fail", message: "a migration started but did not finish" };
  try {
    const applied = new Set(rows.filter((r) => r.finished_at !== null).map((r) => r.migration_name));
    const missing = readMigrations().filter((m) => !applied.has(m.name));
    if (missing.length > 0) return { name: "migrations", status: "fail", message: `${missing.length} migration(s) not applied` };
  } catch {
    // migration files are not shipped next to the bundle: the history check above is all we can do
  }
  return { name: "migrations", status: "ok", message: "all migrations applied" };
}

export interface Runtime {
  handle: (request: Request) => Promise<Response>;
  media?: LocalDiskStorage;
  /** The built admin PWA at /admin/, when it has been built (`npm run admin:build`). */
  adminUi?: AdminUiHandler;
  shutdown(): Promise<void>;
}

export async function createRuntime(config: Config, log: Logger = jsonLogger): Promise<Runtime> {
  const database = await openDatabase(config, log);
  const { db } = database;
  const vendorId = await ensureDefaultVendor(db);
  const repo = new PrismaCatalogRepository(db, vendorId);

  const { storage, media } = createStorage(config, log);

  const auth = createAuthServices(config, db);
  if (config.devAdmin && !(await auth.store.findByEmail(config.devAdmin.email.toLowerCase()))) {
    await auth.service.createAccount({ email: config.devAdmin.email, password: config.devAdmin.password, role: "owner", totpSecret: null });
    log("warn", "dev_admin_created", { email: config.devAdmin.email });
  }

  const limiter = new RateLimiter();
  const customerCookie = { name: config.cookieSecure ? "__Host-jm_c" : "jm_c", secure: config.cookieSecure };
  const platform = createPlatformServices({
    db,
    masterKey: resolveMasterKey(config),
    sms: createSmsProvider(config),
    limiter,
    customerCookie,
    log: (event, detail) => log("warn", event, detail),
    otpPolicy: { ...DEFAULT_OTP_POLICY, dailyBudget: config.sms.dailyLimit },
    probes: {
      database: async () => void (await db.$queryRaw`SELECT 1`),
      migrations: () => checkMigrations(db, config.production),
      storage: async () => {
        const key = `_health/probe-${randomBytes(6).toString("hex")}`;
        await storage.put(key, "ok", { contentType: "text/plain" });
        await storage.delete([key]);
      },
      security: () => securityFacts(config, database.embedded),
    },
  });

  const setup = config.firstRunSetup ? new FirstRunSetup(true, auth.service, auth.store, new RateLimiter()) : undefined;
  if (setup) log("warn", "first_run_setup_enabled", { note: "development only: the first administrator can be created from the browser until one exists" });

  const pending = new Set<Promise<unknown>>();
  const adminApi = createApi({
    setup,
    originHostSuffixes: config.adminOriginHostSuffixes,
    ...(config.adminAcceptRewrittenOrigin ? { rewrittenOriginPort: config.port } : {}),
    originDebug: !config.production,
    ...(config.appCommit ? { build: config.appCommit } : {}),
    adminRoutes: platform.adminRoutes,
    catalog: new CatalogService(repo),
    storage,
    publisher: new SnapshotPublisher(repo, storage, config.publicMediaUrl ?? ""),
    auth: auth.service,
    authenticator: auth.authenticator,
    cookie: auth.cookie,
    sessionMaxAgeSeconds: config.sessionAbsoluteHours * 3600,
    adminOrigins: config.adminOrigins,
    mediaBaseUrl: config.publicMediaUrl ?? "",
    importChunkMax: config.importChunkMax,
    background: (task) => {
      pending.add(task);
      void task.finally(() => pending.delete(task));
    },
    log: (event, detail) => {
      log("error", event, detail);
      // Unhandled server errors become de-duplicated, sanitised error reports (no request data is attached).
      if (event === "unhandled_error") {
        void platform.maintenance.reportError({ source: "server", environment: config.production ? "production" : "development", release: config.release, name: String(detail?.error ?? "Error"), message: event }).catch(() => undefined);
      }
    },
  });

  const customerApi = createCustomerApi({
    enabled: config.customerAccountsEnabled,
    customers: platform.customerStore,
    auth: platform.customerAuth,
    authenticator: platform.customerAuthenticator,
    accounts: platform.accounts,
    support: platform.support,
    maintenance: platform.maintenance,
    cookie: customerCookie,
    sessionMaxAgeSeconds: 30 * 24 * 3600,
    customerOrigins: config.customerOrigins,
    environment: config.production ? "production" : "development",
    limiter,
    log: (event, detail) => log("error", event, detail),
  });
  const handle = (request: Request) => (isCustomerApiPath(new URL(request.url).pathname) ? customerApi(request) : adminApi(request));

  // Scheduled housekeeping. Each job is independent and failures are logged, never fatal.
  const timers: NodeJS.Timeout[] = [];
  const every = (name: string, ms: number, job: () => Promise<unknown>) => {
    const timer = setInterval(() => void job().catch((error: unknown) => log("error", "job_failed", { job: name, error: error instanceof Error ? error.name : "unknown" })), ms);
    timer.unref();
    timers.push(timer);
  };
  every("purge_admin_sessions", 3600_000, () => auth.store.purgeExpired(new Date()));
  if (config.schedulerEnabled) {
    every("health_cycle", 5 * 60_000, () => platform.maintenance.healthCycle());
    every("purge_customer_data", 3600_000, () => platform.customerAuth.purge());
    every("account_deletions", 3600_000, () => platform.accounts.runDeletions());
    every("close_resolved_tickets", 6 * 3600_000, () => platform.support.autoCloseResolved());
    every("prune_maintenance", 24 * 3600_000, () => platform.maintenance.prune());
  }

  let adminUi: AdminUiHandler | undefined;
  if (config.adminUiDir) {
    if (existsSync(join(config.adminUiDir, "index.html"))) {
      let mediaOrigin: string | null = null;
      try {
        mediaOrigin = config.publicMediaUrl ? new URL(config.publicMediaUrl).origin : null;
      } catch {
        mediaOrigin = null;
      }
      adminUi = createAdminUiHandler({ dir: config.adminUiDir, mediaOrigin });
    } else {
      log("warn", "admin_ui_not_built", { note: "run `npm run admin:build` to serve the admin app at /admin/" });
      adminUi = createUnbuiltAdminUiHandler();
    }
  }

  return {
    handle,
    media,
    adminUi,
    async shutdown() {
      for (const timer of timers) clearInterval(timer);
      await Promise.allSettled([...pending]);
      await database.stop();
    },
  };
}

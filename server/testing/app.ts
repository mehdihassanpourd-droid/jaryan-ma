import { randomBytes } from "node:crypto";
import { createApi, CLIENT_IP_HEADER, CSRF_HEADER, type ApiDeps } from "../api";
import { FirstRunSetup } from "../auth/first-run-setup";
import { AuthService, DEFAULT_AUTH_SETTINGS, type AuthSettings } from "../auth/auth-service";
import { ScryptHasher } from "../auth/password";
import { PrismaAdminStore } from "../auth/prisma-store";
import type { Role } from "../auth/rbac";
import { RateLimiter } from "../auth/rate-limit";
import { SecretBox } from "../auth/secret-box";
import { SessionAuthenticator } from "../auth/session";
import { generateTotpSecret, totpAt, totpStep } from "../auth/totp";
import { PrismaCatalogRepository } from "../catalog/prisma-repository";
import { CatalogService } from "../catalog/service";
import { SnapshotPublisher } from "../catalog/snapshot-publisher";
import type { TestDatabase } from "../db/test-database";
import { ensureDefaultVendor } from "../db/vendor";
import { MemoryStorage } from "../storage/memory";
import { createCustomerApi } from "../customer-api";
import { MemorySmsProvider } from "../sms/provider";
import { createPlatformServices, type PlatformServices } from "../services";
import type { SecurityFacts } from "../../src/domain/maintenance/security-checks";

export const ORIGIN = "https://admin.example.test";
export const PASSWORD = "rain-over-the-woven-hills-92";
export const COOKIE_NAME = "jm_session";
export const STORE_ORIGIN = "https://shop.example.test";
export const CUSTOMER_COOKIE = "jm_c";
export const SECURITY_FACTS: SecurityFacts = {
  production: true, encryptionKeyConfigured: true, cookieSecure: true, requireTotp: true, adminOrigins: [ORIGIN], storageDriver: "s3", databaseIsEmbedded: false,
  trustProxy: true, customerAccountsEnabled: true, smsProvider: "http", publicMediaUrl: "https://media.example.test", devAdminConfigured: false,
};

export interface Session {
  cookie: string;
  csrf: string;
}

export interface TestApp {
  handle(request: Request): Promise<Response>;
  storage: MemoryStorage;
  catalog: CatalogService;
  repo: PrismaCatalogRepository;
  auth: AuthService;
  adminStore: PrismaAdminStore;
  deps: ApiDeps;
  /** Customers, support and maintenance (present when built with `platform: true`). */
  platform: PlatformServices;
  sms: MemorySmsProvider;
  customerApi: (request: Request) => Promise<Response>;
  /** Creates (once per role) an account and signs in over HTTP; returns cookie + CSRF token. */
  session(role: Role): Promise<Session>;
  /** Waits for background snapshot work. */
  settle(): Promise<void>;
  /** Moves the shared clock forward. */
  advance(ms: number): void;
  now(): Date;
  logs: Array<{ event: string; detail?: Record<string, unknown> }>;
}

/** Builds the whole server (without HTTP sockets) on a test database. */
export async function buildTestApp(testDb: TestDatabase, overrides: { importChunkMax?: number; auth?: Partial<AuthSettings>; adminOrigins?: string; customerAccountsEnabled?: boolean; firstRunSetup?: boolean; originHostSuffixes?: string[]; originDebug?: boolean; build?: string; rewrittenOriginPort?: number } = {}): Promise<TestApp> {
  await testDb.reset();
  const vendorId = await ensureDefaultVendor(testDb.db);
  let clock = new Date("2026-03-01T10:00:00.000Z");
  const repo = new PrismaCatalogRepository(testDb.db, vendorId, () => clock);
  const catalog = new CatalogService(repo);
  const storage = new MemoryStorage();
  const publisher = new SnapshotPublisher(repo, storage, "https://media.example.test", () => clock.getTime());
  const adminStore = new PrismaAdminStore(testDb.db);
  const settings = { ...DEFAULT_AUTH_SETTINGS, ...overrides.auth };
  const auth = new AuthService(adminStore, new ScryptHasher({ logN: 10, r: 8, p: 1 }), new SecretBox(randomBytes(32)), new RateLimiter(() => clock.getTime()), settings, () => clock);
  const cookie = { name: COOKIE_NAME, secure: true };
  const authenticator = new SessionAuthenticator(adminStore, cookie, { idleMs: 2 * 3600_000, absoluteMs: settings.sessionAbsoluteMs }, () => clock);
  const pending: Promise<unknown>[] = [];
  const logs: TestApp["logs"] = [];
  const deps: ApiDeps = {
    catalog, storage, publisher, auth, authenticator, cookie,
    sessionMaxAgeSeconds: settings.sessionAbsoluteMs / 1000,
    adminOrigins: overrides.adminOrigins ?? ORIGIN,
    mediaBaseUrl: "https://media.example.test",
    importChunkMax: overrides.importChunkMax ?? 10,
    background: (task) => void pending.push(task),
    log: (event, detail) => void logs.push({ event, detail }),
  };
  const limiter = new RateLimiter(() => clock.getTime());
  const sms = new MemorySmsProvider();
  const platform = createPlatformServices({
    db: testDb.db, masterKey: randomBytes(32), sms, limiter, customerCookie: { name: CUSTOMER_COOKIE, secure: true }, clock: () => clock,
    probes: {
      database: async () => void (await testDb.db.$queryRaw`SELECT 1`),
      migrations: async () => ({ name: "migrations", status: "ok", message: "all migrations applied" }),
      storage: async () => undefined,
      security: () => SECURITY_FACTS,
    },
  });
  deps.adminRoutes = platform.adminRoutes;
  if (overrides.originHostSuffixes) deps.originHostSuffixes = overrides.originHostSuffixes;
  if (overrides.originDebug) deps.originDebug = true;
  if (overrides.build) deps.build = overrides.build;
  if (overrides.rewrittenOriginPort !== undefined) deps.rewrittenOriginPort = overrides.rewrittenOriginPort;
  if (overrides.firstRunSetup) deps.setup = new FirstRunSetup(true, auth, adminStore, new RateLimiter(() => clock.getTime()), () => clock);
  const customerApi = createCustomerApi({
    enabled: overrides.customerAccountsEnabled ?? true, customers: platform.customerStore, auth: platform.customerAuth, authenticator: platform.customerAuthenticator,
    accounts: platform.accounts, support: platform.support, maintenance: platform.maintenance, cookie: { name: CUSTOMER_COOKIE, secure: true },
    sessionMaxAgeSeconds: 30 * 24 * 3600, customerOrigins: STORE_ORIGIN, environment: "test", limiter, clock: () => clock, healthCacheMs: 0,
    log: (event, detail) => void logs.push({ event, detail }),
  });
  const handle = createApi(deps);
  const sessions = new Map<Role, Session>();

  return {
    handle: (request) => handle(request), platform, sms, customerApi, storage, catalog, repo, auth, adminStore, deps, logs,
    now: () => clock,
    advance: (ms) => void (clock = new Date(clock.getTime() + ms)),
    async settle() {
      await Promise.all(pending.splice(0));
    },
    async session(role) {
      const existing = sessions.get(role);
      if (existing) return existing;
      const email = `${role}@example.test`;
      const secret = generateTotpSecret();
      await auth.createAccount({ email, password: PASSWORD, role, totpSecret: secret });
      clock = new Date(clock.getTime() + 30_000); // a fresh TOTP step for every sign-in
      const response = await handle(
        new Request("https://admin.example.test/api/v1/auth/login", {
          method: "POST",
          headers: { origin: ORIGIN, "content-type": "application/json", [CLIENT_IP_HEADER]: "10.0.0.1" },
          body: JSON.stringify({ email, password: PASSWORD, totp: totpAt(secret, totpStep(clock.getTime())) }),
        }),
      );
      if (response.status !== 200) throw new Error(`login failed: ${response.status} ${await response.text()}`);
      const setCookie = response.headers.get("set-cookie") ?? "";
      const token = new RegExp(`${COOKIE_NAME}=([^;]+)`).exec(setCookie)?.[1];
      const body = (await response.json()) as { csrfToken: string };
      if (!token) throw new Error("no session cookie");
      const session = { cookie: `${COOKIE_NAME}=${token}`, csrf: body.csrfToken };
      sessions.set(role, session);
      return session;
    },
  };
}

export interface Call {
  /** Host the request is addressed to (default admin.example.test); a forwarder such as GitHub Codespaces keeps the external host. */
  host?: string;
  method?: string;
  path: string;
  as?: Session | null;
  body?: unknown;
  origin?: string | null;
  csrf?: string | null;
  headers?: Record<string, string>;
  raw?: Uint8Array;
  contentType?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- response shapes are asserted individually in each test */
export async function call(app: TestApp, c: Call): Promise<{ status: number; body: any; res: Response }> {
  const method = c.method ?? "GET";
  const headers: Record<string, string> = { [CLIENT_IP_HEADER]: "10.0.0.1", ...c.headers };
  if (c.as) headers.cookie = c.as.cookie;
  if (method !== "GET") {
    if (c.origin !== null) headers.origin = c.origin ?? ORIGIN;
    const csrf = c.csrf === undefined ? c.as?.csrf : c.csrf;
    if (csrf) headers[CSRF_HEADER] = csrf;
  }
  let body: BodyInit | undefined;
  if (c.raw) {
    body = c.raw as unknown as BodyInit;
    headers["content-type"] = c.contentType ?? "image/jpeg";
  } else if (c.body !== undefined) {
    body = JSON.stringify(c.body);
    headers["content-type"] = c.contentType ?? "application/json";
  }
  const res = await app.handle(new Request(`https://${c.host ?? "admin.example.test"}${c.path}`, { method, headers, body }));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, res };
}

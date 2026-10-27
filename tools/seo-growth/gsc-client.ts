import { createSign } from "node:crypto";
import { z } from "zod";
import type { DayData, PageRow, QueryRow } from "./types";

/**
 * Google Search Console (Search Analytics API) over plain HTTPS: service-account JWT sign-in and the `searchAnalytics.query`
 * endpoint, with paging and retries. No Google library, no paid service: the only requirement is the owner's one-time setup
 * (docs/seo/SEARCH-CONSOLE-SETUP-FA.md). This runs ONLY in the monitoring workflow / on a developer machine: never in the storefront,
 * the admin or the API server. Without credentials the callers skip: nothing is invented.
 */
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const DEFAULT_API = "https://www.googleapis.com/webmasters/v3";
const ROW_LIMIT = 25_000;

export class GscError extends Error {
  constructor(
    public code: "gsc_not_configured" | "gsc_bad_credentials" | "gsc_auth_failed" | "gsc_forbidden" | "gsc_not_found" | "gsc_rate_limited" | "gsc_unavailable" | "gsc_bad_response",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "GscError";
  }
}

const serviceAccountSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().includes("PRIVATE KEY"),
  token_uri: z.string().url().default("https://oauth2.googleapis.com/token"),
});
export type ServiceAccount = z.output<typeof serviceAccountSchema>;

/** The key file's JSON text (as stored in the `GSC_SERVICE_ACCOUNT_JSON` secret). The error never echoes the content. */
export function parseServiceAccount(json: string): ServiceAccount {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new GscError("gsc_bad_credentials", "GSC_SERVICE_ACCOUNT_JSON is not valid JSON");
  }
  const parsed = serviceAccountSchema.safeParse(raw);
  if (!parsed.success) throw new GscError("gsc_bad_credentials", "GSC_SERVICE_ACCOUNT_JSON is not a service-account key (client_email / private_key missing)");
  return parsed.data;
}

const b64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

/** The signed assertion Google exchanges for an access token (RS256). */
export function createJwt(account: ServiceAccount, now: Date, scope = GSC_SCOPE): string {
  const iat = Math.floor(now.getTime() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: account.client_email, scope, aud: account.token_uri, iat, exp: iat + 3600 }))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key);
  return `${unsigned}.${b64url(signature)}`;
}

export interface GscOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Base of the API (tests point it at a fake). */
  apiBase?: string;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}

export async function getAccessToken(account: ServiceAccount, options: GscOptions = {}): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const assertion = createJwt(account, (options.now ?? (() => new Date()))());
  let response: Response;
  try {
    response = await fetchImpl(account.token_uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new GscError("gsc_unavailable", "could not reach the Google sign-in endpoint");
  }
  if (!response.ok) throw new GscError(response.status >= 500 ? "gsc_unavailable" : "gsc_auth_failed", `Google sign-in refused (HTTP ${response.status})`);
  const data = (await response.json().catch(() => null)) as { access_token?: unknown } | null;
  if (!data || typeof data.access_token !== "string") throw new GscError("gsc_bad_response", "Google sign-in returned no access token");
  return data.access_token;
}

const rowsSchema = z.object({
  rows: z
    .array(z.object({ keys: z.array(z.string()), clicks: z.number(), impressions: z.number(), ctr: z.number(), position: z.number() }))
    .optional(),
});

export class GscClient {
  /** One sign-in shared by requests running in parallel. */
  private token: Promise<string> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly apiBase: string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;

  constructor(
    private readonly account: ServiceAccount,
    /** `https://example.ir/` (URL-prefix property) or `sc-domain:example.ir` (domain property). */
    readonly siteUrl: string,
    private readonly options: GscOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBase = (options.apiBase ?? DEFAULT_API).replace(/\/+$/, "");
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxAttempts = options.maxAttempts ?? 4;
  }

  private async request(body: Record<string, unknown>): Promise<z.output<typeof rowsSchema>> {
    const url = `${this.apiBase}/sites/${encodeURIComponent(this.siteUrl)}/searchAnalytics/query`;
    let last: GscError | null = null;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (attempt > 0) await this.sleep(500 * 2 ** (attempt - 1));
      this.token ??= getAccessToken(this.account, this.options);
      let bearer: string;
      try {
        bearer = await this.token;
      } catch (error) {
        this.token = null;
        throw error;
      }
      let response: Response;
      try {
        response = await this.fetchImpl(url, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
      } catch {
        last = new GscError("gsc_unavailable", "could not reach Search Console");
        continue;
      }
      if (response.status === 401) {
        this.token = null; // expired: sign in again once, then give up
        last = new GscError("gsc_auth_failed", "Search Console rejected the access token");
        continue;
      }
      if (response.status === 403) throw new GscError("gsc_forbidden", "the service account has no access to this Search Console property (add its e-mail as a user)");
      if (response.status === 404) throw new GscError("gsc_not_found", "Search Console property not found (check GSC_SITE_URL)");
      if (response.status === 429) {
        last = new GscError("gsc_rate_limited", "Search Console rate limit");
        continue;
      }
      if (response.status >= 500) {
        last = new GscError("gsc_unavailable", `Search Console error (HTTP ${response.status})`);
        continue;
      }
      if (!response.ok) throw new GscError("gsc_bad_response", `unexpected Search Console answer (HTTP ${response.status})`);
      const parsed = rowsSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new GscError("gsc_bad_response", "Search Console returned an unexpected body");
      return parsed.data;
    }
    throw last ?? new GscError("gsc_unavailable");
  }

  /** Every row for one day and dimension list, paged. */
  private async rows(date: string, dimensions: string[]) {
    const out: Array<z.output<typeof rowsSchema>["rows"] extends infer R ? (R extends Array<infer E> ? E : never) : never> = [];
    for (let startRow = 0; ; startRow += ROW_LIMIT) {
      const page = await this.request({ startDate: date, endDate: date, dimensions, rowLimit: ROW_LIMIT, startRow, type: "web", dataState: "final" });
      const rows = page.rows ?? [];
      out.push(...rows);
      if (rows.length < ROW_LIMIT) return out;
    }
  }

  /** One day: per page, and per page + query. */
  async fetchDay(date: string): Promise<DayData> {
    const [pages, queries] = await Promise.all([this.rows(date, ["page"]), this.rows(date, ["page", "query"])]);
    const toMetrics = (r: { clicks: number; impressions: number; ctr: number; position: number }) => ({ clicks: r.clicks, impressions: r.impressions, ctr: Math.min(1, Math.max(0, r.ctr)), position: r.position });
    return {
      date,
      fetchedAt: (this.options.now ?? (() => new Date()))().toISOString(),
      source: "gsc",
      siteUrl: this.siteUrl,
      pages: pages.flatMap((r): PageRow[] => (r.keys[0] ? [{ page: r.keys[0], ...toMetrics(r) }] : [])),
      queries: queries.flatMap((r): QueryRow[] => (r.keys[0] && r.keys[1] ? [{ page: r.keys[0], query: r.keys[1], ...toMetrics(r) }] : [])),
    };
  }
}

/** Reads the credentials from the environment; `null` = not configured (callers skip, nothing is made up). */
export function clientFromEnv(env: Record<string, string | undefined>, options: GscOptions = {}): GscClient | null {
  const json = env.GSC_SERVICE_ACCOUNT_JSON?.trim();
  const site = env.GSC_SITE_URL?.trim();
  if (!json || !site) return null;
  return new GscClient(parseServiceAccount(json), site, options);
}

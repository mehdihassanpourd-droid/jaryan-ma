import { createPublicKey, generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GscClient, GscError, clientFromEnv, createJwt, getAccessToken, parseServiceAccount } from "./gsc-client";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const keyJson = JSON.stringify({ client_email: "monitor@project.iam.gserviceaccount.com", private_key: privateKey, token_uri: "https://oauth2.example.test/token" });
const account = parseServiceAccount(keyJson);
const NOW = new Date("2026-11-10T05:00:00.000Z");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake Google: one token endpoint and one Search Analytics endpoint whose answers the test scripts. */
function fakeGoogle(answer: (body: Record<string, unknown>, call: number, headers: Headers) => Response | Promise<Response>) {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
  let tokens = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u === "https://oauth2.example.test/token") {
      tokens++;
      return json({ access_token: `token-${tokens}`, expires_in: 3600 });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url: u, body, auth: new Headers(init?.headers).get("authorization") });
    return answer(body, calls.length, new Headers(init?.headers));
  }) as typeof fetch;
  return { fetchImpl, calls, tokens: () => tokens };
}
const client = (g: ReturnType<typeof fakeGoogle>, extra = {}) => new GscClient(account, "sc-domain:example.ir", { fetchImpl: g.fetchImpl, now: () => NOW, sleep: async () => undefined, apiBase: "https://api.example.test/v3", ...extra });
const row = (keys: string[], clicks = 1, impressions = 10) => ({ keys, clicks, impressions, ctr: clicks / impressions, position: 4.5 });

describe("service-account credentials", () => {
  it("accepts a key file and rejects anything else without echoing it", () => {
    expect(account.client_email).toBe("monitor@project.iam.gserviceaccount.com");
    for (const bad of ["not json", "{}", JSON.stringify({ client_email: "x", private_key: "y" }), JSON.stringify({ client_email: "a@b.co", private_key: "plain text" })]) {
      const error = (() => {
        try {
          parseServiceAccount(bad);
        } catch (e) {
          return e as GscError;
        }
      })();
      expect(error?.code).toBe("gsc_bad_credentials");
      expect(error?.message).not.toContain(bad.slice(0, 20) === "not json" ? "xyz" : "plain text");
    }
  });

  it("is not configured without both the key and the property: callers skip", () => {
    expect(clientFromEnv({})).toBeNull();
    expect(clientFromEnv({ GSC_SERVICE_ACCOUNT_JSON: keyJson })).toBeNull();
    expect(clientFromEnv({ GSC_SITE_URL: "sc-domain:example.ir" })).toBeNull();
    expect(clientFromEnv({ GSC_SERVICE_ACCOUNT_JSON: keyJson, GSC_SITE_URL: "sc-domain:example.ir" })).toBeInstanceOf(GscClient);
  });
});

describe("sign-in", () => {
  it("builds an RS256 JWT with the right claims, signed by the account's key", () => {
    const [h, c, s] = createJwt(account, NOW).split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims).toMatchObject({ iss: account.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.example.test/token", iat: Math.floor(NOW.getTime() / 1000) });
    expect(claims.exp - claims.iat).toBe(3600);
    const ok = createVerify("RSA-SHA256").update(`${h}.${c}`).verify(createPublicKey(publicKey), Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });

  it("asks only for the read-only scope", () => {
    expect(createJwt(account, NOW).split(".")[1]).toBeTruthy();
    const claims = JSON.parse(Buffer.from(createJwt(account, NOW).split(".")[1]!, "base64url").toString());
    expect(claims.scope).toBe("https://www.googleapis.com/auth/webmasters.readonly");
  });

  it("maps refusals to short codes (no keys, no bodies)", async () => {
    const refuse = (status: number) => (async () => new Response("secret body " + privateKey, { status })) as unknown as typeof fetch;
    await expect(getAccessToken(account, { fetchImpl: refuse(400), now: () => NOW })).rejects.toMatchObject({ code: "gsc_auth_failed" });
    await expect(getAccessToken(account, { fetchImpl: refuse(503), now: () => NOW })).rejects.toMatchObject({ code: "gsc_unavailable" });
    const e = await getAccessToken(account, { fetchImpl: refuse(400), now: () => NOW }).catch((x: Error) => x);
    expect(String(e)).not.toMatch(/secret body|PRIVATE KEY/);
    await expect(getAccessToken(account, { fetchImpl: (async () => json({})) as unknown as typeof fetch, now: () => NOW })).rejects.toMatchObject({ code: "gsc_bad_response" });
    await expect(getAccessToken(account, { fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch, now: () => NOW })).rejects.toMatchObject({ code: "gsc_unavailable" });
  });
});

describe("one day of data", () => {
  it("asks for pages and for page+query rows of that day, web search, final data, with a bearer token", async () => {
    const g = fakeGoogle((body) => json({ rows: (body.dimensions as string[]).length === 1 ? [row(["https://example.ir/a"], 3, 30)] : [row(["https://example.ir/a", "ماکرومه"], 2, 20)] }));
    const day = await client(g).fetchDay("2026-11-07");
    expect(g.calls.map((c) => c.body.dimensions).sort()).toEqual([["page"], ["page", "query"]]);
    for (const c of g.calls) {
      expect(c.url).toBe("https://api.example.test/v3/sites/sc-domain%3Aexample.ir/searchAnalytics/query");
      expect(c.body).toMatchObject({ startDate: "2026-11-07", endDate: "2026-11-07", type: "web", dataState: "final", rowLimit: 25000, startRow: 0 });
      expect(c.auth).toBe("Bearer token-1");
    }
    expect(day).toMatchObject({ date: "2026-11-07", source: "gsc", siteUrl: "sc-domain:example.ir", pages: [{ page: "https://example.ir/a", clicks: 3, impressions: 30 }], queries: [{ page: "https://example.ir/a", query: "ماکرومه", clicks: 2 }] });
    expect(g.tokens()).toBe(1); // one sign-in serves both requests
  });

  it("pages through large days and handles empty days", async () => {
    const many = Array.from({ length: 25_000 }, (_, i) => row([`https://example.ir/p${i}`]));
    const g = fakeGoogle((body) => ((body.dimensions as string[]).length === 2 ? json({}) : json({ rows: body.startRow === 0 ? many : [row(["https://example.ir/last"])] })));
    const day = await client(g).fetchDay("2026-11-07");
    expect(day.pages).toHaveLength(25_001);
    expect(day.queries).toEqual([]); // no rows at all is an empty day, not an error
  });

  it("clamps impossible CTR values and drops rows without keys", async () => {
    const g = fakeGoogle(() => json({ rows: [{ keys: ["https://example.ir/a"], clicks: 1, impressions: 2, ctr: 1.7, position: 3 }, { keys: [], clicks: 1, impressions: 1, ctr: 1, position: 1 }] }));
    const day = await client(g).fetchDay("2026-11-07");
    expect(day.pages).toEqual([{ page: "https://example.ir/a", clicks: 1, impressions: 2, ctr: 1, position: 3 }]);
  });
});

describe("failures", () => {
  it("403: the service account was not added to the property (a clear, final error, no retries)", async () => {
    const g = fakeGoogle(() => json({ error: { message: "User does not have sufficient permission" } }, 403));
    await expect(client(g).fetchDay("2026-11-07")).rejects.toMatchObject({ code: "gsc_forbidden" });
    expect(g.calls.length).toBeLessThanOrEqual(2); // the two parallel first requests, nothing more
  });

  it("404: unknown property", async () => {
    await expect(client(fakeGoogle(() => json({}, 404))).fetchDay("2026-11-07")).rejects.toMatchObject({ code: "gsc_not_found" });
  });

  it("429 and 5xx are retried with back-off and then succeed", async () => {
    const waits: number[] = [];
    let n = 0;
    const g = fakeGoogle(() => (++n <= 3 ? json({}, n === 1 ? 429 : 503) : json({ rows: [row(["https://example.ir/a"])] })));
    const day = await client(g, { sleep: async (ms: number) => void waits.push(ms) }).fetchDay("2026-11-07");
    expect(day.pages.length).toBeGreaterThan(0);
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.every((w, i) => i === 0 || w >= waits[i - 1]!)).toBe(true);
  });

  it("gives up after the attempts, with a short code", async () => {
    await expect(client(fakeGoogle(() => json({}, 503)), { maxAttempts: 2 }).fetchDay("2026-11-07")).rejects.toMatchObject({ code: "gsc_unavailable" });
    await expect(client(fakeGoogle(() => json({}, 429)), { maxAttempts: 2 }).fetchDay("2026-11-07")).rejects.toMatchObject({ code: "gsc_rate_limited" });
  });

  it("an expired token (401) is replaced once by signing in again", async () => {
    let first = true;
    const g = fakeGoogle((_b, _n, headers) => {
      if (headers.get("authorization") === "Bearer token-1" && first) {
        first = false;
        return json({}, 401);
      }
      return json({ rows: [row(["https://example.ir/a"])] });
    });
    const day = await client(g).fetchDay("2026-11-07");
    expect(day.pages.length).toBeGreaterThan(0);
    expect(g.tokens()).toBeGreaterThanOrEqual(2);
  });

  it("unexpected bodies are rejected", async () => {
    await expect(client(fakeGoogle(() => json({ rows: [{ nope: 1 }] }))).fetchDay("2026-11-07")).rejects.toMatchObject({ code: "gsc_bad_response" });
    await expect(client(fakeGoogle(() => new Response("<html>", { status: 200 }))).fetchDay("2026-11-07")).rejects.toMatchObject({ code: "gsc_bad_response" });
  });
});

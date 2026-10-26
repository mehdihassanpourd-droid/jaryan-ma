import { beforeAll, describe, expect, it } from "vitest";
import { AuthError, createJwksFetcher, isValidTeamDomain, verifyAccessJwt, type AccessConfig } from "../src/auth/access";
import { ACTIONS, can, type Role } from "../src/auth/rbac";
import { AUD, NOW, TEAM, b64url, makeKey, signJwt, type TestKey } from "./jwt-helper";

let key: TestKey;
let otherKey: TestKey;
let config: AccessConfig;

beforeAll(async () => {
  key = await makeKey("key-1");
  otherKey = await makeKey("key-2");
  config = { teamDomain: TEAM, audience: AUD, getKeys: async () => [key.publicJwk], now: () => NOW };
});

const reject = async (token: string, cfg: AccessConfig = config) => {
  const error = await verifyAccessJwt(token, cfg).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AuthError);
  return (error as AuthError).code;
};

describe("verifyAccessJwt", () => {
  it("accepts a valid token and lowercases the email", async () => {
    const claims = await verifyAccessJwt(await signJwt(key, { claims: { email: "Admin@Example.Test" } }), config);
    expect(claims).toMatchObject({ email: "admin@example.test", sub: "user-1" });
  });

  it("accepts a string audience and a token within clock leeway", async () => {
    expect((await verifyAccessJwt(await signJwt(key, { claims: { aud: AUD } }), config)).email).toBe("admin@example.test");
    expect((await verifyAccessJwt(await signJwt(key, { claims: { exp: NOW - 10 } }), config)).email).toBe("admin@example.test");
  });

  it("rejects expired and not-yet-valid tokens", async () => {
    expect(await reject(await signJwt(key, { claims: { exp: NOW - 120 } }))).toBe("expired");
    expect(await reject(await signJwt(key, { claims: { nbf: NOW + 120 } }))).toBe("not_yet_valid");
    expect(await reject(await signJwt(key, { claims: { exp: undefined } }))).toBe("expired");
  });

  it("rejects the wrong issuer or audience", async () => {
    expect(await reject(await signJwt(key, { claims: { iss: "https://evil.cloudflareaccess.com" } }))).toBe("bad_issuer");
    expect(await reject(await signJwt(key, { claims: { aud: ["someone-else"] } }))).toBe("bad_audience");
    expect(await reject(await signJwt(key, { claims: { aud: undefined } }))).toBe("bad_audience");
  });

  it("rejects a token signed by a different key, and tampered payloads", async () => {
    const forged = await signJwt({ ...otherKey, kid: "key-1" });
    expect(await reject(forged)).toBe("bad_signature");

    const [h, , s] = (await signJwt(key)).split(".") as [string, string, string];
    const tamperedPayload = b64url(JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], email: "attacker@example.test", exp: NOW + 3600 }));
    expect(await reject(`${h}.${tamperedPayload}.${s}`)).toBe("bad_signature");
  });

  it("rejects non-RS256 algorithms (none, HS256 confusion)", async () => {
    const claims = b64url(JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], email: "a@example.test", exp: NOW + 3600 }));
    expect(await reject(`${b64url(JSON.stringify({ alg: "none", kid: "key-1" }))}.${claims}.`)).toBe("unsupported_algorithm");
    expect(await reject(`${b64url(JSON.stringify({ alg: "HS256", kid: "key-1" }))}.${claims}.${b64url("x")}`)).toBe("unsupported_algorithm");
  });

  it("rejects unknown keys, missing kid and re-fetches keys once on a miss", async () => {
    expect(await reject(await signJwt({ ...key, kid: "rotated" }))).toBe("unknown_key");
    expect(await reject(await signJwt(key, { header: { kid: undefined } }))).toBe("missing_kid");

    const calls: boolean[] = [];
    const rotating: AccessConfig = { ...config, getKeys: async (refresh) => { calls.push(refresh); return refresh ? [otherKey.publicJwk] : [key.publicJwk]; } };
    const ok = await verifyAccessJwt(await signJwt(otherKey), rotating);
    expect(ok.email).toBe("admin@example.test");
    expect(calls).toEqual([false, true]);
  });

  it("rejects malformed input and bad email claims", async () => {
    for (const bad of ["", "abc", "a.b", "a.b.c.d", "x".repeat(9000)]) expect(await reject(bad)).toBe("malformed_token");
    expect(await reject(await signJwt(key, { claims: { email: "not-an-email" } }))).toBe("missing_email");
    expect(await reject(await signJwt(key, { claims: { email: undefined } }))).toBe("missing_email");
  });

  it("refuses to work without a valid team domain or audience", async () => {
    const token = await signJwt(key);
    expect(await reject(token, { ...config, teamDomain: "evil.example.com" })).toBe("access_not_configured");
    expect(await reject(token, { ...config, audience: "" })).toBe("access_not_configured");
    expect(isValidTeamDomain("a-b.cloudflareaccess.com")).toBe(true);
    expect(isValidTeamDomain("a.b.cloudflareaccess.com")).toBe(false);
    expect(isValidTeamDomain("cloudflareaccess.com.evil.test")).toBe(false);
    expect(isValidTeamDomain(undefined)).toBe(false);
  });
});

describe("createJwksFetcher", () => {
  const response = (keys: unknown[]) => new Response(JSON.stringify({ keys }), { status: 200 });

  it("caches keys and only refreshes after the cooldown", async () => {
    let clock = 0;
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => { urls.push(url); return response([key.publicJwk]); }) as unknown as typeof fetch;
    const get = createJwksFetcher(TEAM, fetchImpl, 3_600_000, () => clock);
    await get(false);
    await get(false);
    clock = 10_000;
    await get(true); // within cooldown: served from cache
    expect(urls).toEqual([`https://${TEAM}/cdn-cgi/access/certs`]);
    clock = 120_000;
    await get(true);
    expect(urls).toHaveLength(2);
  });

  it("fails safely on bad responses and invalid domains", async () => {
    const down = createJwksFetcher(TEAM, (async () => new Response("no", { status: 500 })) as unknown as typeof fetch);
    await expect(down(false)).rejects.toMatchObject({ code: "keys_unavailable" });
    const empty = createJwksFetcher(TEAM, (async () => response([])) as unknown as typeof fetch);
    await expect(empty(false)).rejects.toMatchObject({ code: "keys_unavailable" });
    const evil = createJwksFetcher("evil.example.com", (async () => response([key.publicJwk])) as unknown as typeof fetch);
    await expect(evil(false)).rejects.toMatchObject({ code: "access_not_configured" });
  });
});

describe("roles", () => {
  const allowed = (role: Role) => ACTIONS.filter((a) => can(role, a));
  it("viewers can only read", () => expect(allowed("viewer")).toEqual(["product:read"]));
  it("editors manage the catalogue but not administrators", () => {
    expect(allowed("editor")).toContain("product:publish");
    expect(allowed("editor")).not.toContain("admin:manage");
  });
  it("owners can do everything", () => expect(allowed("owner")).toEqual([...ACTIONS]));
});

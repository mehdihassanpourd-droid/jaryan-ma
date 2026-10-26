/**
 * Verification of Cloudflare Access application tokens (the `Cf-Access-Jwt-Assertion`
 * header). Cloudflare Access performs the actual login (identity provider, MFA,
 * session); this module proves a request really passed through it, so the Worker is
 * safe even if the Access policy is misconfigured or the Worker is reached directly.
 *
 * Verified: RS256 signature against the team's published keys (selected by `kid`),
 * issuer, audience, expiry and not-before. Anything else (including `alg: none` or
 * HMAC "algorithm confusion") is rejected.
 */
export class AuthError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/** A JSON Web Key as published by Access (the DOM type omits `kid`). */
export type Jwk = JsonWebKey & { kid?: string };

export interface AccessClaims {
  email: string;
  sub: string;
  exp: number;
}

export interface AccessConfig {
  /** e.g. `myteam.cloudflareaccess.com` */
  teamDomain: string;
  /** AUD tag of the Access application. */
  audience: string;
  /** Returns the team's public JWKs. `refresh` forces a re-fetch (unknown `kid`, key rotation). */
  getKeys: (refresh: boolean) => Promise<Jwk[]>;
  /** Unix seconds; injectable for tests. */
  now?: () => number;
}

const TEAM_DOMAIN = /^[a-z0-9-]+\.cloudflareaccess\.com$/;
const LEEWAY_SECONDS = 30;
const MAX_TOKEN_LENGTH = 8192;

export function isValidTeamDomain(value: string | undefined): value is string {
  return typeof value === "string" && TEAM_DOMAIN.test(value);
}

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function decodeJson(part: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new AuthError("malformed_token");
  }
}

export async function verifyAccessJwt(token: string, config: AccessConfig): Promise<AccessClaims> {
  if (!isValidTeamDomain(config.teamDomain) || !config.audience) throw new AuthError("access_not_configured");
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) throw new AuthError("malformed_token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("malformed_token");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  const header = decodeJson(headerPart);
  if (header.alg !== "RS256") throw new AuthError("unsupported_algorithm");
  if (typeof header.kid !== "string") throw new AuthError("missing_kid");

  let keys = await config.getKeys(false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await config.getKeys(true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk || jwk.kty !== "RSA") throw new AuthError("unknown_key");

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { ...jwk, alg: "RS256", ext: true, key_ops: ["verify"] },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlToBytes(signaturePart) as BufferSource,
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    );
  } catch {
    throw new AuthError("bad_signature");
  }
  if (!valid) throw new AuthError("bad_signature");

  const payload = decodeJson(payloadPart);
  const now = (config.now ?? (() => Math.floor(Date.now() / 1000)))();
  if (payload.iss !== `https://${config.teamDomain}`) throw new AuthError("bad_issuer");
  const aud = payload.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(config.audience)) throw new AuthError("bad_audience");
  if (typeof payload.exp !== "number" || payload.exp + LEEWAY_SECONDS < now) throw new AuthError("expired");
  if (typeof payload.nbf === "number" && payload.nbf - LEEWAY_SECONDS > now) throw new AuthError("not_yet_valid");
  const email = payload.email;
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("missing_email");

  return { email: email.toLowerCase(), sub: typeof payload.sub === "string" ? payload.sub : "", exp: payload.exp };
}

/** Fetches (and caches per isolate) the team's signing keys. Refetches at most once a minute on demand. */
export function createJwksFetcher(teamDomain: string, fetchImpl: typeof fetch = fetch, ttlMs = 3_600_000, now: () => number = Date.now) {
  let cache: { keys: Jwk[]; at: number } | null = null;
  return async (refresh: boolean): Promise<Jwk[]> => {
    if (!isValidTeamDomain(teamDomain)) throw new AuthError("access_not_configured");
    const age = cache ? now() - cache.at : Infinity;
    if (cache && age < ttlMs && !(refresh && age > 60_000)) return cache.keys;
    const response = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new AuthError("keys_unavailable");
    const body = (await response.json()) as { keys?: Jwk[] };
    if (!Array.isArray(body.keys) || body.keys.length === 0) throw new AuthError("keys_unavailable");
    cache = { keys: body.keys, at: now() };
    return cache.keys;
  };
}

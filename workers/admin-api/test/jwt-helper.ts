import type { Jwk } from "../src/auth/access";

export const TEAM = "test-team.cloudflareaccess.com";
export const AUD = "aud-tag-123";
export const NOW = 1_800_000_000;

const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export interface TestKey {
  kid: string;
  publicJwk: Jwk;
  privateKey: CryptoKey;
}

export async function makeKey(kid = "key-1"): Promise<TestKey> {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Jwk;
  return { kid, publicJwk: { ...publicJwk, kid, alg: "RS256", use: "sig" }, privateKey: pair.privateKey };
}

export interface SignOptions {
  header?: Record<string, unknown>;
  claims?: Record<string, unknown>;
}

export async function signJwt(key: TestKey, options: SignOptions = {}): Promise<string> {
  const header = { alg: "RS256", kid: key.kid, typ: "JWT", ...options.header };
  const claims = { iss: `https://${TEAM}`, aud: [AUD], email: "admin@example.test", sub: "user-1", iat: NOW - 10, nbf: NOW - 10, exp: NOW + 3600, ...options.claims };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(signature)}`;
}

export { b64url };

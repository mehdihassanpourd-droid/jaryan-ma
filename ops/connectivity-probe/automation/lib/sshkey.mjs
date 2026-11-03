// Stateless SSH identity. The private keys are DERIVED (HKDF-SHA256) from a secret the repository already holds, so every later
// workflow run (day 2, day 3, ... and the clean-up) regenerates exactly the same keys. Nothing is stored: no artifact, no cache,
// no committed file. Rotating the secret changes the keys (a server created earlier can then no longer be reached over SSH,
// which is why the sweeper deletes through the API and never needs SSH).
import { createPrivateKey, createPublicKey, hkdfSync } from "node:crypto";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const str = (b) => Buffer.concat([u32(b.length), Buffer.isBuffer(b) ? b : Buffer.from(b)]);

export function deriveSeed(secret, purpose) {
  if (typeof secret !== "string" || secret.length < 16) throw new Error("secret too short to derive keys from");
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.from("jm-probe/ssh/v1"), Buffer.from(purpose), 32));
}

export function ed25519(seed) {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
  const raw = Buffer.from(createPublicKey(key).export({ format: "jwk" }).x, "base64url");
  return { seed, publicRaw: raw, pkcs8Pem: key.export({ format: "pem", type: "pkcs8" }) };
}

const pubBlob = (raw) => Buffer.concat([str("ssh-ed25519"), str(raw)]);
export const publicLine = (raw, comment = "jm-probe") => `ssh-ed25519 ${pubBlob(raw).toString("base64")} ${comment}`;
export const knownHostsLine = (host, raw) => `${host} ssh-ed25519 ${pubBlob(raw).toString("base64")}`;

/** Unencrypted OpenSSH private key file for an ed25519 key (format "openssh-key-v1"). */
export function openSshPrivate({ seed, publicRaw }, comment = "jm-probe") {
  const check = Buffer.from("0badf00d", "hex");
  let priv = Buffer.concat([check, check, str("ssh-ed25519"), str(publicRaw), str(Buffer.concat([seed, publicRaw])), str(comment)]);
  for (let i = 1; priv.length % 8 !== 0; i++) priv = Buffer.concat([priv, Buffer.from([i])]);
  const body = Buffer.concat([Buffer.from("openssh-key-v1\0"), str("none"), str("none"), str(Buffer.alloc(0)), u32(1), str(pubBlob(publicRaw)), str(priv)]);
  const lines = body.toString("base64").match(/.{1,70}/g).join("\n");
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

/** The identity the workflows use: one client key and one pinned SERVER host key, both derived from the same secret. */
export function deriveIdentity(secret) {
  const client = ed25519(deriveSeed(secret, "client"));
  const host = ed25519(deriveSeed(secret, "host"));
  return { client, host };
}

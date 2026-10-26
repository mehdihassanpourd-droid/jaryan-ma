import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** RFC 6238 time-based one-time passwords (SHA-1, 6 digits, 30 s): compatible with every authenticator app. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD_SECONDS = 30;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid_base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

/**
 * Returns the accepted time step, or null. Allows one step of clock drift either way and refuses any
 * step that is not newer than `lastStep`, so a code can never be used twice (replay protection).
 */
export function verifyTotp(secret: string, code: string, nowMs: number, lastStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(nowMs);
  let accepted: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(totpAt(secret, step));
    const given = Buffer.from(code);
    // Evaluate every candidate: no early exit, so timing does not reveal which step matched.
    if (timingSafeEqual(expected, given) && accepted === null && (lastStep === null || step > lastStep)) accepted = step;
  }
  return accepted;
}

export function otpauthUri(options: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${options.issuer}:${options.account}`);
  const params = new URLSearchParams({ secret: options.secret, issuer: options.issuer, algorithm: "SHA1", digits: "6", period: String(TOTP_PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

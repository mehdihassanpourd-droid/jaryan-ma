import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
  needsRehash(stored: string): boolean;
}

export interface ScryptParams {
  /** CPU/memory cost is N = 2^logN. 17 (about 128 MiB per hash) follows the OWASP guidance for scrypt. */
  logN: number;
  r: number;
  p: number;
}

export const DEFAULT_SCRYPT: ScryptParams = { logN: 17, r: 8, p: 1 };
const KEY_LENGTH = 64;
const MAX_LOG_N = 20;

class Semaphore {
  private waiting: Array<() => void> = [];
  private active = 0;
  constructor(private readonly limit: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

const derive = (password: string, salt: Buffer, p: ScryptParams): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const N = 2 ** p.logN;
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { N, r: p.r, p: p.p, maxmem: 256 * N * p.r }, (err, key) => (err ? reject(err) : resolve(key)));
  });

/**
 * scrypt password hashing (Node built-in, no native dependency). Stored as
 * `scrypt$logN$r$p$salt$hash`, so parameters can be raised later and old hashes upgraded at login.
 * At most `maxConcurrent` hashes run at once so a burst of logins cannot exhaust memory.
 */
export class ScryptHasher implements PasswordHasher {
  private readonly gate: Semaphore;

  constructor(
    private readonly params: ScryptParams = DEFAULT_SCRYPT,
    maxConcurrent = 2,
  ) {
    this.gate = new Semaphore(maxConcurrent);
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await this.gate.run(() => derive(password, salt, this.params));
    const { logN, r, p } = this.params;
    return `scrypt$${logN}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
  }

  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parse(stored);
    if (!parsed) return false;
    const key = await this.gate.run(() => derive(password, parsed.salt, parsed.params));
    return key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash);
  }

  needsRehash(stored: string): boolean {
    const parsed = parse(stored);
    if (!parsed) return true;
    return parsed.params.logN < this.params.logN || parsed.params.r !== this.params.r || parsed.params.p !== this.params.p;
  }
}

function parse(stored: string): { params: ScryptParams; salt: Buffer; hash: Buffer } | null {
  const [scheme, logN, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !logN || !r || !p || !salt || !hash) return null;
  const params = { logN: Number(logN), r: Number(r), p: Number(p) };
  if (!Number.isInteger(params.logN) || params.logN < 4 || params.logN > MAX_LOG_N || !Number.isInteger(params.r) || !Number.isInteger(params.p)) return null;
  return { params, salt: Buffer.from(salt, "base64"), hash: Buffer.from(hash, "base64") };
}

const COMMON = new Set(["password1234", "123456789012", "qwertyuiop12", "administrator", "changemeplease", "letmein12345", "iloveyou1234", "welcome12345"]);

export type PasswordIssue = "too_short" | "too_long" | "contains_email" | "too_common" | "low_variety";

/** NIST-style policy: length over composition rules, and no obvious choices. Returns [] when acceptable. */
export function checkPasswordPolicy(password: string, email: string): PasswordIssue[] {
  const p = password.normalize("NFKC");
  const issues: PasswordIssue[] = [];
  if (p.length < 12) issues.push("too_short");
  if (p.length > 128) issues.push("too_long");
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && p.toLowerCase().includes(local)) issues.push("contains_email");
  if (COMMON.has(p.toLowerCase())) issues.push("too_common");
  if (new Set(p).size < 6) issues.push("low_variety");
  return issues;
}

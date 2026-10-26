import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Authenticated encryption (AES-256-GCM) for secrets stored in the database (TOTP seeds), so a leaked
 * database dump alone does not reveal them. The key lives only in the server environment.
 * Format: `v1.<base64url(iv | tag | ciphertext)>`.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
    this.key = key;
  }

  static fromBase64(value: string): SecretBox {
    return new SecretBox(Buffer.from(value, "base64"));
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
  }

  open(sealed: string): string {
    if (!sealed.startsWith("v1.")) throw new Error("unsupported_secret_format");
    const raw = Buffer.from(sealed.slice(3), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
}

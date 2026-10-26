import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ScryptHasher, checkPasswordPolicy, DEFAULT_SCRYPT } from "./password";
import { RateLimiter } from "./rate-limit";
import { SecretBox } from "./secret-box";
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, totpAt, totpStep, verifyTotp } from "./totp";

const fast = new ScryptHasher({ logN: 10, r: 8, p: 1 });

describe("ScryptHasher", () => {
  it("verifies the right password and rejects wrong ones", async () => {
    const stored = await fast.hash("correct horse battery");
    expect(stored.startsWith("scrypt$10$8$1$")).toBe(true);
    expect(await fast.verify("correct horse battery", stored)).toBe(true);
    expect(await fast.verify("correct horse batterY", stored)).toBe(false);
    expect(await fast.verify("", stored)).toBe(false);
  });

  it("uses a fresh salt per hash and normalises Unicode (NFKC)", async () => {
    const a = await fast.hash("پسورد-امن-۱۲۳۴۵");
    const b = await fast.hash("پسورد-امن-۱۲۳۴۵");
    expect(a).not.toBe(b);
    expect(await fast.verify("پسورد-امن-۱۲۳۴۵", a)).toBe(true);
    expect(await fast.verify("ﬁne-password-here", await fast.hash("fine-password-here"))).toBe(true);
  });

  it("rejects malformed or hostile stored values instead of throwing", async () => {
    for (const bad of ["", "plain", "scrypt$10$8$1$only-three", "scrypt$99$8$1$AAAA$AAAA", "bcrypt$10$8$1$AAAA$AAAA", "scrypt$x$8$1$AAAA$AAAA"]) {
      expect(await fast.verify("anything", bad)).toBe(false);
    }
  });

  it("flags weaker stored parameters for upgrade", async () => {
    const strong = new ScryptHasher({ logN: 11, r: 8, p: 1 });
    expect(strong.needsRehash(await fast.hash("x-password-123"))).toBe(true);
    expect(fast.needsRehash(await fast.hash("x-password-123"))).toBe(false);
    expect(fast.needsRehash("garbage")).toBe(true);
  });

  it("limits concurrent hashing", async () => {
    const hasher = new ScryptHasher({ logN: 10, r: 8, p: 1 }, 1);
    const results = await Promise.all([hasher.hash("a-password-1"), hasher.hash("a-password-2"), hasher.hash("a-password-3")]);
    expect(new Set(results).size).toBe(3);
  });

  it("works with the production parameters", async () => {
    expect(DEFAULT_SCRYPT.logN).toBeGreaterThanOrEqual(17);
    const prod = new ScryptHasher();
    const stored = await prod.hash("a-long-production-password");
    expect(await prod.verify("a-long-production-password", stored)).toBe(true);
  }, 30_000);
});

describe("checkPasswordPolicy", () => {
  it("accepts long, non-obvious passwords", () => {
    expect(checkPasswordPolicy("rain-over-the-woven-hills-92", "owner@example.com")).toEqual([]);
  });
  it.each([
    ["short1", "too_short"],
    ["a".repeat(129), "too_long"],
    ["PASSWORD1234", "too_common"],
    ["aaaaaaaaaaaaaaaa", "low_variety"],
    ["my-owner-password-1", "contains_email"],
  ])("rejects %j", (password, issue) => {
    expect(checkPasswordPolicy(password, "owner@example.com")).toContain(issue);
  });
});

describe("TOTP (RFC 6238)", () => {
  // RFC 6238 Appendix B SHA-1 test secret "12345678901234567890"; expected values are the last 6 digits.
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("matches the RFC vector at t=%i", (seconds, expected) => {
    expect(totpAt(secret, totpStep(seconds * 1000))).toBe(expected);
  });

  it("round-trips base32 and generates valid secrets", () => {
    const bytes = randomBytes(20);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
    expect(() => base32Decode("not base32!")).toThrow();
  });

  const t = 1_800_000_000_000;
  it("accepts the current code and one step of drift, nothing else", () => {
    const step = totpStep(t);
    expect(verifyTotp(secret, totpAt(secret, step), t, null)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), t, null)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step + 1), t, null)).toBe(step + 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), t, null)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step + 2), t, null)).toBeNull();
  });

  it("never accepts a step twice (replay protection)", () => {
    const step = totpStep(t);
    const code = totpAt(secret, step);
    expect(verifyTotp(secret, code, t, step - 1)).toBe(step);
    expect(verifyTotp(secret, code, t, step)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step - 1), t, step)).toBeNull();
  });

  it("rejects malformed codes", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 345", "٠١٢٣٤٥"]) expect(verifyTotp(secret, bad, t, null)).toBeNull();
  });

  it("builds an otpauth URI for authenticator apps", () => {
    const uri = otpauthUri({ secret: "ABC234", account: "owner@example.com", issuer: "Jaryan Ma" });
    expect(uri).toBe("otpauth://totp/Jaryan%20Ma%3Aowner%40example.com?secret=ABC234&issuer=Jaryan+Ma&algorithm=SHA1&digits=6&period=30");
  });
});

describe("SecretBox", () => {
  const box = new SecretBox(randomBytes(32));
  it("round-trips and uses a fresh nonce each time", () => {
    const a = box.seal("JBSWY3DPEHPK3PXP");
    expect(a).not.toBe(box.seal("JBSWY3DPEHPK3PXP"));
    expect(box.open(a)).toBe("JBSWY3DPEHPK3PXP");
    expect(a).not.toContain("JBSWY3DPEHPK3PXP");
  });
  it("detects tampering, wrong keys and unknown formats", () => {
    const sealed = box.seal("secret");
    const tampered = sealed.slice(0, -3) + (sealed.endsWith("AAA") ? "BBB" : "AAA");
    expect(() => box.open(tampered)).toThrow();
    expect(() => new SecretBox(randomBytes(32)).open(sealed)).toThrow();
    expect(() => box.open("v2.abc")).toThrow("unsupported_secret_format");
  });
  it("requires a 32-byte key and loads it from base64", () => {
    expect(() => new SecretBox(randomBytes(16))).toThrow();
    const key = randomBytes(32);
    expect(SecretBox.fromBase64(key.toString("base64")).open(new SecretBox(key).seal("x"))).toBe("x");
  });
});

describe("RateLimiter", () => {
  it("allows up to the limit per window and reports retry time", () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    for (let i = 0; i < 3; i++) expect(limiter.hit("k", 3, 60_000).allowed).toBe(true);
    const blocked = limiter.hit("k", 3, 60_000);
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 60 });
    now = 59_000;
    expect(limiter.hit("k", 3, 60_000).retryAfterSeconds).toBe(1);
    now = 60_001;
    expect(limiter.hit("k", 3, 60_000).allowed).toBe(true);
  });
  it("keeps keys independent", () => {
    const limiter = new RateLimiter(() => 0);
    limiter.hit("a", 1, 1000);
    expect(limiter.hit("a", 1, 1000).allowed).toBe(false);
    expect(limiter.hit("b", 1, 1000).allowed).toBe(true);
  });
});

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AdminStore, Authenticator, Principal } from "./ports";

export const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");
export const newToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function parseCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out.set(part.slice(0, eq).trim(), decodeURIComponent(part.slice(eq + 1).trim()));
  }
  return out;
}

export interface CookieSettings {
  name: string;
  secure: boolean;
}

/** HttpOnly + SameSite=Strict: scripts cannot read it and other sites cannot send it. */
export function sessionCookie(settings: CookieSettings, token: string, maxAgeSeconds: number): string {
  return `${settings.name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${settings.secure ? "; Secure" : ""}`;
}

export function clearedSessionCookie(settings: CookieSettings): string {
  return `${settings.name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${settings.secure ? "; Secure" : ""}`;
}

export interface SessionPolicy {
  /** Sign out after this long without activity. */
  idleMs: number;
  /** Sign out after this long regardless of activity. */
  absoluteMs: number;
}

const TOUCH_INTERVAL_MS = 60_000;

/** Authenticates requests by the session cookie against server-side sessions. */
export class SessionAuthenticator implements Authenticator {
  constructor(
    private readonly store: AdminStore,
    private readonly cookie: CookieSettings,
    private readonly policy: SessionPolicy,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async authenticate(request: Request): Promise<Principal | null> {
    const token = parseCookies(request.headers.get("cookie")).get(this.cookie.name);
    if (!token || token.length > 200) return null;
    const session = await this.store.findSession(sha256Hex(token));
    if (!session) return null;

    const now = this.clock();
    const expired = session.expiresAt <= now || now.getTime() - session.lastSeenAt.getTime() > this.policy.idleMs;
    if (expired || session.account.disabled) {
      await this.store.deleteSession(session.id);
      return null;
    }
    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) await this.store.touchSession(session.id, now);
    return { userId: session.account.id, email: session.account.email, role: session.account.role, sessionId: session.id, csrfToken: session.csrfToken };
  }
}

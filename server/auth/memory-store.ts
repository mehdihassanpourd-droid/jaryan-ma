import { randomUUID } from "node:crypto";
import { AccountExistsError, type AdminAccount, type AdminStore, type AuditEntry, type SessionRecord } from "./ports";

/** In-memory AdminStore for fast unit tests and throw-away development. Data is lost on restart. */
export class MemoryAdminStore implements AdminStore {
  readonly accounts = new Map<string, AdminAccount>();
  readonly sessions = new Map<string, SessionRecord>();
  readonly auditLog: AuditEntry[] = [];

  async findByEmail(email: string) {
    return [...this.accounts.values()].find((a) => a.email === email) ?? null;
  }
  async findById(id: string) {
    return this.accounts.get(id) ?? null;
  }
  async listAccounts() {
    return [...this.accounts.values()].map((a) => ({ ...a }));
  }
  async createAccount(data: { email: string; passwordHash: string; role: AdminAccount["role"]; totpSecretEnc: string | null }) {
    if (await this.findByEmail(data.email)) throw new AccountExistsError();
    const account: AdminAccount = { id: randomUUID(), ...data, totpLastStep: null, disabled: false, failedLogins: 0, lockedUntil: null };
    this.accounts.set(account.id, account);
    return { ...account };
  }
  private mutate(id: string, change: (a: AdminAccount) => void) {
    const a = this.accounts.get(id);
    if (a) change(a);
  }
  async setPassword(id: string, passwordHash: string, at?: Date) {
    void at;
    this.mutate(id, (a) => void (a.passwordHash = passwordHash));
  }
  async setTotp(id: string, secretEnc: string | null) {
    this.mutate(id, (a) => {
      a.totpSecretEnc = secretEnc;
      a.totpLastStep = null;
    });
  }
  async setDisabled(id: string, disabled: boolean) {
    this.mutate(id, (a) => void (a.disabled = disabled));
  }
  async acceptTotpStep(id: string, step: number) {
    const a = this.accounts.get(id);
    if (!a || (a.totpLastStep !== null && a.totpLastStep >= step)) return false;
    a.totpLastStep = step;
    return true;
  }
  async recordFailure(id: string) {
    const a = this.accounts.get(id);
    if (!a) return 0;
    return ++a.failedLogins;
  }
  async clearFailures(id: string) {
    this.mutate(id, (a) => {
      a.failedLogins = 0;
      a.lockedUntil = null;
    });
  }
  async lock(id: string, until: Date) {
    this.mutate(id, (a) => {
      a.lockedUntil = until;
      a.failedLogins = 0;
    });
  }

  async createSession(data: Omit<SessionRecord, "id">) {
    const session = { id: randomUUID(), ...data };
    this.sessions.set(session.id, session);
    return { ...session };
  }
  async findSession(tokenHash: string) {
    const session = [...this.sessions.values()].find((s) => s.tokenHash === tokenHash);
    const account = session ? this.accounts.get(session.userId) : undefined;
    return session && account ? { ...session, account: { ...account } } : null;
  }
  async touchSession(id: string, at: Date) {
    const s = this.sessions.get(id);
    if (s) s.lastSeenAt = at;
  }
  async deleteSession(id: string) {
    this.sessions.delete(id);
  }
  async deleteSessionsForUser(userId: string, exceptSessionId?: string) {
    for (const [id, s] of this.sessions) if (s.userId === userId && id !== exceptSessionId) this.sessions.delete(id);
  }
  async purgeExpired(now: Date) {
    let n = 0;
    for (const [id, s] of this.sessions) {
      if (s.expiresAt <= now) {
        this.sessions.delete(id);
        n++;
      }
    }
    return n;
  }
  async audit(entry: AuditEntry) {
    this.auditLog.push(entry);
  }
}

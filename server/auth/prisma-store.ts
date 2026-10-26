import { Prisma } from "../../src/generated/prisma/client";
import type { Db } from "../db/client";
import { AccountExistsError, type AdminAccount, type AdminStore, type AuditEntry, type SessionRecord } from "./ports";

const ACCOUNT = {
  id: true,
  email: true,
  passwordHash: true,
  role: true,
  totpSecretEnc: true,
  totpLastStep: true,
  disabled: true,
  failedLogins: true,
  lockedUntil: true,
} satisfies Prisma.AdminUserSelect;

/** PostgreSQL (Prisma) implementation of the admin store: the production implementation. */
export class PrismaAdminStore implements AdminStore {
  constructor(private readonly db: Db) {}

  findByEmail(email: string): Promise<AdminAccount | null> {
    return this.db.adminUser.findUnique({ where: { email }, select: ACCOUNT });
  }

  findById(id: string): Promise<AdminAccount | null> {
    return this.db.adminUser.findUnique({ where: { id }, select: ACCOUNT });
  }

  listAccounts(): Promise<AdminAccount[]> {
    return this.db.adminUser.findMany({ orderBy: { email: "asc" }, select: ACCOUNT });
  }

  async createAccount(data: { email: string; passwordHash: string; role: AdminAccount["role"]; totpSecretEnc: string | null }) {
    try {
      return await this.db.adminUser.create({ data, select: ACCOUNT });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new AccountExistsError();
      throw error;
    }
  }

  async setPassword(id: string, passwordHash: string, at: Date) {
    await this.db.adminUser.update({ where: { id }, data: { passwordHash, passwordChangedAt: at } });
  }

  async setTotp(id: string, secretEnc: string | null) {
    await this.db.adminUser.update({ where: { id }, data: { totpSecretEnc: secretEnc, totpLastStep: null } });
  }

  async setDisabled(id: string, disabled: boolean) {
    await this.db.adminUser.update({ where: { id }, data: { disabled } });
  }

  async acceptTotpStep(id: string, step: number) {
    const r = await this.db.adminUser.updateMany({ where: { id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
    return r.count > 0;
  }

  async recordFailure(id: string) {
    const row = await this.db.adminUser.update({ where: { id }, data: { failedLogins: { increment: 1 } }, select: { failedLogins: true } });
    return row.failedLogins;
  }

  async clearFailures(id: string) {
    await this.db.adminUser.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null } });
  }

  async lock(id: string, until: Date) {
    await this.db.adminUser.update({ where: { id }, data: { lockedUntil: until, failedLogins: 0 } });
  }

  async createSession(data: Omit<SessionRecord, "id">): Promise<SessionRecord> {
    return this.db.adminSession.create({ data });
  }

  async findSession(tokenHash: string) {
    const row = await this.db.adminSession.findUnique({ where: { tokenHash }, include: { user: { select: ACCOUNT } } });
    if (!row) return null;
    const { user, ...session } = row;
    return { ...session, account: user };
  }

  async touchSession(id: string, at: Date) {
    await this.db.adminSession.updateMany({ where: { id }, data: { lastSeenAt: at } });
  }

  async deleteSession(id: string) {
    await this.db.adminSession.deleteMany({ where: { id } });
  }

  async deleteSessionsForUser(userId: string, exceptSessionId?: string) {
    await this.db.adminSession.deleteMany({ where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } });
  }

  async purgeExpired(now: Date) {
    return (await this.db.adminSession.deleteMany({ where: { expiresAt: { lte: now } } })).count;
  }

  async audit(entry: AuditEntry) {
    await this.db.auditLog.create({
      data: { actorEmail: entry.actorEmail, action: entry.action, entity: entry.entity, entityId: entry.entityId, detail: (entry.detail ?? {}) as Prisma.InputJsonValue, at: entry.at },
    });
  }
}

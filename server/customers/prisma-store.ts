import { Prisma } from "../../src/generated/prisma/client";
import type { Db } from "../db/client";
import { DuplicateCustomerError, type CustomerRecord, type CustomerSessionRecord, type CustomerStore, type OtpRecord } from "./ports";

const CUSTOMER = {
  id: true,
  phone: true,
  firstName: true,
  lastName: true,
  email: true,
  status: true,
  termsAcceptedAt: true,
  termsVersion: true,
  marketingOptIn: true,
  phoneVerifiedAt: true,
  lastLoginAt: true,
  deletionRequestedAt: true,
  deletionScheduledAt: true,
  createdAt: true,
} satisfies Prisma.CustomerSelect;

function duplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const detail = `${error.message} ${JSON.stringify(error.meta ?? {})}`.toLowerCase();
    throw new DuplicateCustomerError(detail.includes("email") ? "email" : "phone");
  }
  throw error;
}

/** PostgreSQL (Prisma) implementation of the customer store. */
export class PrismaCustomerStore implements CustomerStore {
  constructor(private readonly db: Db) {}

  // ---- one-time codes -----------------------------------------------------------------------

  async createOtp(data: { id: string; phone: string; codeHash: string; expiresAt: Date; ip: string | null; now: Date }) {
    await this.db.customerOtp.create({ data: { id: data.id, phone: data.phone, codeHash: data.codeHash, expiresAt: data.expiresAt, ip: data.ip, createdAt: data.now } });
  }

  async invalidateOpenOtps(phone: string, now: Date) {
    await this.db.customerOtp.updateMany({ where: { phone, consumedAt: null, invalidatedAt: null }, data: { invalidatedAt: now } });
  }

  async setOtpProviderMessageId(id: string, providerMessageId: string | null) {
    await this.db.customerOtp.update({ where: { id }, data: { providerMessageId } });
  }

  async findActiveOtp(phone: string, now: Date): Promise<OtpRecord | null> {
    return this.db.customerOtp.findFirst({
      where: { phone, consumedAt: null, invalidatedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      select: { id: true, phone: true, codeHash: true, attempts: true, expiresAt: true, createdAt: true },
    });
  }

  async recordOtpFailure(id: string): Promise<number> {
    const row = await this.db.customerOtp.update({ where: { id }, data: { attempts: { increment: 1 } }, select: { attempts: true } });
    return row.attempts;
  }

  async invalidateOtp(id: string, now: Date) {
    await this.db.customerOtp.updateMany({ where: { id, invalidatedAt: null }, data: { invalidatedAt: now } });
  }

  async consumeOtp(id: string, now: Date): Promise<boolean> {
    const r = await this.db.customerOtp.updateMany({ where: { id, consumedAt: null, invalidatedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    return r.count === 1;
  }

  async recentOtpTimes(phone: string, since: Date): Promise<Date[]> {
    const rows = await this.db.customerOtp.findMany({ where: { phone, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 50, select: { createdAt: true } });
    return rows.map((r) => r.createdAt);
  }

  countOtpsByIp(ip: string, since: Date): Promise<number> {
    return this.db.customerOtp.count({ where: { ip, createdAt: { gte: since } } });
  }

  countOtpsSince(since: Date): Promise<number> {
    return this.db.customerOtp.count({ where: { createdAt: { gte: since } } });
  }

  // ---- customers ----------------------------------------------------------------------------

  findByPhone(phone: string): Promise<CustomerRecord | null> {
    return this.db.customer.findUnique({ where: { phone }, select: CUSTOMER });
  }

  findById(id: string): Promise<CustomerRecord | null> {
    return this.db.customer.findUnique({ where: { id }, select: CUSTOMER });
  }

  async createCustomer(data: { phone: string; termsVersion: string; now: Date }): Promise<CustomerRecord> {
    try {
      return await this.db.customer.create({
        data: { phone: data.phone, termsVersion: data.termsVersion, termsAcceptedAt: data.now, phoneVerifiedAt: data.now, createdAt: data.now, updatedAt: data.now },
        select: CUSTOMER,
      });
    } catch (error) {
      return duplicate(error);
    }
  }

  async touchLogin(id: string, now: Date) {
    await this.db.customer.update({ where: { id }, data: { lastLoginAt: now } });
  }

  async updateProfile(id: string, patch: { firstName?: string | null; lastName?: string | null; email?: string | null; marketingOptIn?: boolean }, now: Date): Promise<CustomerRecord> {
    try {
      return await this.db.customer.update({ where: { id }, data: { ...patch, updatedAt: now }, select: CUSTOMER });
    } catch (error) {
      return duplicate(error);
    }
  }

  // ---- sessions -----------------------------------------------------------------------------

  async createSession(data: Omit<CustomerSessionRecord, "id">): Promise<CustomerSessionRecord> {
    return this.db.customerSession.create({ data });
  }

  async findSession(tokenHash: string) {
    const row = await this.db.customerSession.findUnique({ where: { tokenHash }, include: { customer: { select: CUSTOMER } } });
    if (!row) return null;
    const { customer, ...session } = row;
    return { ...session, customer };
  }

  async touchSession(id: string, at: Date) {
    await this.db.customerSession.updateMany({ where: { id }, data: { lastSeenAt: at } });
  }

  async deleteSession(id: string) {
    await this.db.customerSession.deleteMany({ where: { id } });
  }

  async deleteSessionsForCustomer(customerId: string, exceptSessionId?: string) {
    await this.db.customerSession.deleteMany({ where: { customerId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } });
  }

  async purgeExpiredSessions(now: Date) {
    return (await this.db.customerSession.deleteMany({ where: { expiresAt: { lte: now } } })).count;
  }

  async purgeOldOtps(before: Date) {
    return (await this.db.customerOtp.deleteMany({ where: { createdAt: { lt: before } } })).count;
  }
}

/**
 * Ports for customer accounts. Implemented for PostgreSQL (Prisma); any database can be supported by writing
 * another adapter against these interfaces.
 */
export type CustomerStatus = "active" | "pending_deletion" | "anonymized" | "suspended";

export interface CustomerRecord {
  id: string;
  /** Canonical +989XXXXXXXXX (or "deleted:<id>" once anonymised). */
  phone: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  status: CustomerStatus;
  termsAcceptedAt: Date;
  termsVersion: string;
  marketingOptIn: boolean;
  phoneVerifiedAt: Date;
  lastLoginAt: Date | null;
  deletionRequestedAt: Date | null;
  deletionScheduledAt: Date | null;
  createdAt: Date;
}

export interface OtpRecord {
  id: string;
  phone: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  createdAt: Date;
}

export interface CustomerSessionRecord {
  id: string;
  customerId: string;
  tokenHash: string;
  csrfToken: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

export class DuplicateCustomerError extends Error {
  constructor(public field: "phone" | "email") {
    super(`duplicate_${field}`);
    this.name = "DuplicateCustomerError";
  }
}

export interface CustomerStore {
  // ---- one-time codes
  createOtp(data: { id: string; phone: string; codeHash: string; expiresAt: Date; ip: string | null; now: Date }): Promise<void>;
  /** Marks every still-open code for the number as invalidated (only the newest code may be used). */
  invalidateOpenOtps(phone: string, now: Date): Promise<void>;
  setOtpProviderMessageId(id: string, providerMessageId: string | null): Promise<void>;
  /** Newest code that is unconsumed, not invalidated and not expired. */
  findActiveOtp(phone: string, now: Date): Promise<OtpRecord | null>;
  /** Atomically increments the failed-attempt counter and returns the new value. */
  recordOtpFailure(id: string): Promise<number>;
  invalidateOtp(id: string, now: Date): Promise<void>;
  /** Atomic: true only for the one caller that consumes a still-valid code (a code can never be used twice). */
  consumeOtp(id: string, now: Date): Promise<boolean>;
  /** Send times of codes to a number since `since` (newest first, at most 50). */
  recentOtpTimes(phone: string, since: Date): Promise<Date[]>;
  countOtpsByIp(ip: string, since: Date): Promise<number>;
  countOtpsSince(since: Date): Promise<number>;

  // ---- customers
  findByPhone(phone: string): Promise<CustomerRecord | null>;
  findById(id: string): Promise<CustomerRecord | null>;
  /** Throws DuplicateCustomerError when the phone is already registered. */
  createCustomer(data: { phone: string; termsVersion: string; now: Date }): Promise<CustomerRecord>;
  touchLogin(id: string, now: Date): Promise<void>;
  /** Throws DuplicateCustomerError("email") when another customer uses the address. */
  updateProfile(id: string, patch: { firstName?: string | null; lastName?: string | null; email?: string | null; marketingOptIn?: boolean }, now: Date): Promise<CustomerRecord>;

  // ---- sessions
  createSession(data: Omit<CustomerSessionRecord, "id">): Promise<CustomerSessionRecord>;
  findSession(tokenHash: string): Promise<(CustomerSessionRecord & { customer: CustomerRecord }) | null>;
  touchSession(id: string, at: Date): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteSessionsForCustomer(customerId: string, exceptSessionId?: string): Promise<void>;
  purgeExpiredSessions(now: Date): Promise<number>;
  purgeOldOtps(before: Date): Promise<number>;
}

export interface CustomerPrincipal {
  customerId: string;
  phone: string;
  sessionId: string;
  csrfToken: string;
  status: CustomerStatus;
}

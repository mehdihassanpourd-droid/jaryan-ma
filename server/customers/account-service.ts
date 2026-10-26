import { MAX_ADDRESSES_PER_CUSTOMER, MAX_FAVORITES_PER_CUSTOMER, type AddressInput, type ProfileUpdate } from "../../src/domain/customer/schema";
import type { AccountStore, CustomerExportCore } from "./account-ports";
import type { CustomerRecord, CustomerStore } from "./ports";

export type AccountErrorCode = "not_found" | "limit_reached" | "rate_limited" | "open_orders" | "not_pending_deletion";

export class AccountError extends Error {
  constructor(
    public code: AccountErrorCode,
    public retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "AccountError";
  }
}

export interface AccountSettings {
  /** Days between requesting deletion and the irreversible anonymisation (time to change one's mind). */
  deletionGraceDays: number;
  /** A data export may be requested at most once per this many milliseconds. */
  exportIntervalMs: number;
}

export const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = { deletionGraceDays: 14, exportIntervalMs: 3600_000 };

export const EXPORT_FORMAT_VERSION = 1;

export interface CustomerExport extends CustomerExportCore {
  formatVersion: number;
  generatedAt: Date;
  /** Support tickets and the messages the customer can see (never internal notes). */
  support: unknown;
}

/** Hook that adds the customer-visible support history to an export. */
export type SupportExporter = (customerId: string) => Promise<unknown>;

export class AccountService {
  constructor(
    private readonly accounts: AccountStore,
    private readonly customers: CustomerStore,
    private readonly settings: AccountSettings = DEFAULT_ACCOUNT_SETTINGS,
    private readonly clock: () => Date = () => new Date(),
    private readonly supportExporter: SupportExporter = async () => [],
  ) {}

  // ---- profile
  updateProfile(customerId: string, patch: ProfileUpdate): Promise<CustomerRecord> {
    return this.customers.updateProfile(customerId, patch, this.clock());
  }

  // ---- addresses
  listAddresses(customerId: string) {
    return this.accounts.listAddresses(customerId);
  }

  async createAddress(customerId: string, input: AddressInput) {
    const existing = await this.accounts.listAddresses(customerId);
    if (existing.length >= MAX_ADDRESSES_PER_CUSTOMER) throw new AccountError("limit_reached");
    return this.accounts.createAddress(customerId, input, this.clock());
  }

  async updateAddress(customerId: string, id: string, input: AddressInput) {
    const row = await this.accounts.updateAddress(customerId, id, input, this.clock());
    if (!row) throw new AccountError("not_found");
    return row;
  }

  async deleteAddress(customerId: string, id: string) {
    if (!(await this.accounts.deleteAddress(customerId, id))) throw new AccountError("not_found");
  }

  async setDefaultAddress(customerId: string, id: string) {
    if (!(await this.accounts.setDefaultAddress(customerId, id))) throw new AccountError("not_found");
  }

  // ---- favourites
  listFavorites(customerId: string, page: number, pageSize: number) {
    return this.accounts.listFavorites(customerId, page, pageSize);
  }

  async addFavorite(customerId: string, slug: string) {
    if ((await this.accounts.countFavorites(customerId)) >= MAX_FAVORITES_PER_CUSTOMER) throw new AccountError("limit_reached");
    const result = await this.accounts.addFavorite(customerId, slug, this.clock());
    if (result === "not_found") throw new AccountError("not_found");
    return result;
  }

  async removeFavorite(customerId: string, slug: string) {
    // Idempotent: removing something that is not a favourite is not an error.
    await this.accounts.removeFavorite(customerId, slug);
  }

  // ---- orders (read only)
  listOrders(customerId: string, page: number, pageSize: number) {
    return this.accounts.listOrders(customerId, page, pageSize);
  }

  async getOrder(customerId: string, number: number) {
    const order = await this.accounts.getOrder(customerId, number);
    if (!order) throw new AccountError("not_found");
    return order;
  }

  // ---- export and deletion
  async exportData(customerId: string): Promise<CustomerExport> {
    const now = this.clock();
    const last = await this.accounts.lastDataRequestAt(customerId, "export");
    if (last && now.getTime() - last.getTime() < this.settings.exportIntervalMs) {
      throw new AccountError("rate_limited", Math.ceil((last.getTime() + this.settings.exportIntervalMs - now.getTime()) / 1000));
    }
    const core = await this.accounts.gatherExport(customerId);
    if (!core) throw new AccountError("not_found");
    const requestId = await this.accounts.recordDataRequest(customerId, "export", now);
    const support = await this.supportExporter(customerId);
    await this.accounts.completeDataRequest(requestId, now);
    return { formatVersion: EXPORT_FORMAT_VERSION, generatedAt: now, ...core, support };
  }

  /** Starts the grace period. Idempotent while already pending. Returns when the data will be erased. */
  async requestDeletion(customerId: string, currentSessionId?: string): Promise<{ scheduledAt: Date }> {
    const customer = await this.customers.findById(customerId);
    if (!customer || customer.status === "anonymized") throw new AccountError("not_found");
    if (customer.status === "pending_deletion" && customer.deletionScheduledAt) return { scheduledAt: customer.deletionScheduledAt };
    if ((await this.accounts.countOpenOrders(customerId)) > 0) throw new AccountError("open_orders");
    const now = this.clock();
    const scheduledAt = new Date(now.getTime() + this.settings.deletionGraceDays * 24 * 3600_000);
    await this.accounts.requestDeletion(customerId, now, scheduledAt, currentSessionId);
    return { scheduledAt };
  }

  async cancelDeletion(customerId: string) {
    if (!(await this.accounts.cancelDeletion(customerId, this.clock()))) throw new AccountError("not_pending_deletion");
  }

  /** Scheduled job: erases every account whose grace period has ended. Returns the number erased. */
  async runDeletions(limit = 50): Promise<number> {
    const now = this.clock();
    let done = 0;
    for (const id of await this.accounts.listDueDeletions(now, limit)) if (await this.accounts.anonymize(id, now)) done++;
    return done;
  }
}

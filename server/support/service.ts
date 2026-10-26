import { createHash } from "node:crypto";
import { DEFAULT_SUPPORT_LIMITS, assessMessage, normalizeForDuplicate, type SupportLimits } from "../../src/domain/support/abuse";
import type { FaqItemInput, TicketCreateInput, TicketListQuery, TicketUpdate } from "../../src/domain/support/schema";
import { canStaffTransition, onCustomerReply, onStaffReply, AUTO_CLOSE_DAYS } from "../../src/domain/support/workflow";
import type { TicketStatus } from "../../src/domain/support/types";
import { can, type Action, type Role } from "../auth/rbac";
import type { RateLimiter } from "../auth/rate-limit";
import type { AuditEntry } from "../auth/ports";
import type { FaqCategoryView, SupportStore } from "./ports";
import { DEFAULT_FAQ } from "./default-faq";

export type SupportErrorCode =
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "too_many_open"
  | "duplicate"
  | "spam"
  | "ticket_closed"
  | "reopen_expired"
  | "invalid_transition"
  | "invalid_assignee"
  | "account_suspended"
  | "invalid_order"
  | "validation";

export class SupportError extends Error {
  constructor(
    public code: SupportErrorCode,
    public retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "SupportError";
  }
}

/** The signed-in staff member performing an action (from the admin session). */
export interface StaffActor {
  userId: string;
  email: string;
  role: Role;
}

export type SupportAudit = (entry: AuditEntry) => Promise<void>;

const HOUR = 3600_000;
const DAY = 24 * HOUR;

const duplicateKeyOf = (body: string) => createHash("sha256").update(normalizeForDuplicate(body)).digest("hex");

export class SupportService {
  constructor(
    private readonly store: SupportStore,
    private readonly limiter: RateLimiter,
    private readonly audit: SupportAudit = async () => {},
    private readonly limits: SupportLimits = DEFAULT_SUPPORT_LIMITS,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private require(actor: StaffActor, action: Action) {
    if (!can(actor.role, action)) throw new SupportError("forbidden");
  }

  // ---------------------------------------------------------------------------------------------
  // Customer side. Every method takes the authenticated customer's id and only ever touches that
  // customer's tickets: an unknown ticket and someone else's ticket are indistinguishable (not_found).
  // ---------------------------------------------------------------------------------------------

  private async guardCustomerMessage(customerId: string, body: string, suspended: boolean) {
    if (suspended) throw new SupportError("account_suspended");
    const verdict = assessMessage(body, this.limits);
    if (verdict.spam) throw new SupportError("spam");
    // In-memory burst guard on top of the durable per-hour count below.
    const burst = this.limiter.hit(`support:burst:${customerId}`, 5, 60_000);
    if (!burst.allowed) throw new SupportError("rate_limited", burst.retryAfterSeconds);
    const now = this.clock();
    if ((await this.store.countCustomerMessagesSince(customerId, new Date(now.getTime() - HOUR))) >= this.limits.messagesPerHour) throw new SupportError("rate_limited", 600);
  }

  async createTicket(customer: { id: string; suspended?: boolean }, input: TicketCreateInput) {
    const customerId = customer.id;
    await this.guardCustomerMessage(customerId, input.body, customer.suspended === true);
    const now = this.clock();

    if ((await this.store.countTicketsSince(customerId, new Date(now.getTime() - HOUR))) >= this.limits.ticketsPerHour) throw new SupportError("rate_limited", 900);
    if ((await this.store.countTicketsSince(customerId, new Date(now.getTime() - DAY))) >= this.limits.ticketsPerDay) throw new SupportError("rate_limited", 3600);
    if ((await this.store.countUnfinishedTickets(customerId)) >= this.limits.maxOpenTickets) throw new SupportError("too_many_open");

    const duplicateKey = duplicateKeyOf(`${input.subject} ${input.body}`);
    if (await this.store.hasRecentDuplicate(customerId, duplicateKey, new Date(now.getTime() - this.limits.duplicateWindowMs))) throw new SupportError("duplicate");

    let orderId: string | null = null;
    if (input.orderNumber !== undefined) {
      orderId = await this.store.ownedOrderId(customerId, input.orderNumber);
      if (!orderId) throw new SupportError("invalid_order"); // same answer for "does not exist" and "not yours"
    }
    return this.store.createTicket({ customerId, orderId, subject: input.subject, category: input.category, body: input.body, duplicateKey, now });
  }

  listCustomerTickets(customerId: string, page: number, pageSize: number) {
    return this.store.listCustomerTickets(customerId, page, pageSize);
  }

  async getCustomerTicket(customerId: string, number: number) {
    const ticket = await this.store.getCustomerTicket(customerId, number);
    if (!ticket) throw new SupportError("not_found");
    return ticket;
  }

  async customerReply(customer: { id: string; suspended?: boolean }, number: number, body: string) {
    const header = await this.store.customerTicketHeader(customer.id, number);
    if (!header) throw new SupportError("not_found");
    await this.guardCustomerMessage(customer.id, body, customer.suspended === true);
    const now = this.clock();
    const decision = onCustomerReply(header.status, header.resolvedAt, now);
    if (!decision.ok) throw new SupportError(decision.reason === "closed" ? "ticket_closed" : "reopen_expired");
    const last = await this.store.lastCustomerMessageBody(header.id);
    if (last !== null && normalizeForDuplicate(last) === normalizeForDuplicate(body)) throw new SupportError("duplicate");
    await this.store.addCustomerMessage(header.id, body, decision.status, now);
    return this.getCustomerTicket(customer.id, number);
  }

  /** For the account data export: the customer's own tickets and the messages they can see. */
  exportForCustomer(customerId: string) {
    return this.store.exportForCustomer(customerId);
  }

  // ---------------------------------------------------------------------------------------------
  // Staff side. Role checks are made here, not only at the HTTP layer.
  // ---------------------------------------------------------------------------------------------

  async listTickets(actor: StaffActor, query: TicketListQuery) {
    this.require(actor, "support:read");
    return this.store.listTickets(query);
  }

  async getTicket(actor: StaffActor, number: number) {
    this.require(actor, "support:read");
    const ticket = await this.store.getStaffTicket(number);
    if (!ticket) throw new SupportError("not_found");
    // Internal notes need their own permission: a role that may read tickets but not notes sees none.
    return can(actor.role, "support:note") ? ticket : { ...ticket, notes: [] };
  }

  async stats(actor: StaffActor) {
    this.require(actor, "support:read");
    return this.store.countByStatus();
  }

  async reply(actor: StaffActor, number: number, body: string, requestedStatus?: TicketStatus) {
    this.require(actor, "support:reply");
    const header = await this.store.staffTicketHeader(number);
    if (!header) throw new SupportError("not_found");
    const status = onStaffReply(header.status, requestedStatus);
    if (status === null) throw new SupportError(header.status === "closed" ? "ticket_closed" : "invalid_transition");
    await this.store.addStaffMessage(header.id, actor.userId, body, status, this.clock());
    await this.audit({ actorEmail: actor.email, action: "support.reply", entity: "ticket", entityId: header.id, detail: { number, status }, at: this.clock() });
  }

  async addNote(actor: StaffActor, number: number, body: string) {
    this.require(actor, "support:note");
    const header = await this.store.staffTicketHeader(number);
    if (!header) throw new SupportError("not_found");
    await this.store.addNote(header.id, actor.userId, body, this.clock());
    await this.audit({ actorEmail: actor.email, action: "support.note", entity: "ticket", entityId: header.id, detail: { number }, at: this.clock() });
  }

  async updateTicket(actor: StaffActor, number: number, patch: TicketUpdate) {
    this.require(actor, "support:manage");
    const header = await this.store.staffTicketHeader(number);
    if (!header) throw new SupportError("not_found");
    if (patch.status && patch.status !== header.status && !canStaffTransition(header.status, patch.status)) throw new SupportError("invalid_transition");
    const effective = patch.status === header.status ? { ...patch, status: undefined } : patch;
    if (!(await this.store.updateTicket(header.id, effective, this.clock()))) throw new SupportError("invalid_assignee");
    await this.audit({ actorEmail: actor.email, action: "support.update", entity: "ticket", entityId: header.id, detail: { number, ...patch }, at: this.clock() });
  }

  /** Scheduled job: closes tickets that were resolved and then left alone. */
  async autoCloseResolved(): Promise<number> {
    const now = this.clock();
    return this.store.closeResolvedBefore(new Date(now.getTime() - AUTO_CLOSE_DAYS * DAY), now);
  }

  // ---------------------------------------------------------------------------------------------
  // FAQ
  // ---------------------------------------------------------------------------------------------

  publicFaq(): Promise<FaqCategoryView[]> {
    return this.store.listPublishedFaq();
  }

  async listFaqForAdmin(actor: StaffActor) {
    this.require(actor, "faq:write");
    return this.store.listAllFaq();
  }

  async saveFaqItem(actor: StaffActor, input: FaqItemInput) {
    this.require(actor, "faq:write");
    if (!(await this.store.upsertFaqItem(input, this.clock()))) throw new SupportError("not_found");
    await this.audit({ actorEmail: actor.email, action: "faq.save", entity: "faq", entityId: input.slug, detail: { published: input.published }, at: this.clock() });
  }

  async saveFaqCategory(actor: StaffActor, input: { slug: string; title: string; position: number }) {
    this.require(actor, "faq:write");
    await this.store.upsertFaqCategory(input);
    await this.audit({ actorEmail: actor.email, action: "faq.category", entity: "faq", entityId: input.slug, at: this.clock() });
  }

  async deleteFaqItem(actor: StaffActor, slug: string) {
    this.require(actor, "faq:write");
    if (!(await this.store.deleteFaqItem(slug))) throw new SupportError("not_found");
    await this.audit({ actorEmail: actor.email, action: "faq.delete", entity: "faq", entityId: slug, at: this.clock() });
  }

  async seedFaq(actor: StaffActor): Promise<number> {
    this.require(actor, "faq:write");
    return this.seedDefaultFaq();
  }

  /** Adds the starter FAQ. Idempotent and non-destructive: existing (possibly edited) entries are left alone. */
  async seedDefaultFaq(): Promise<number> {
    const now = this.clock();
    for (const c of DEFAULT_FAQ.categories) await this.store.insertFaqCategoryIfAbsent(c);
    let created = 0;
    for (const item of DEFAULT_FAQ.items) if (await this.store.insertFaqItemIfAbsent(item, now)) created++;
    return created;
  }
}

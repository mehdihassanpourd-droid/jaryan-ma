import type { TicketCategory, TicketPriority, TicketStatus } from "../../src/domain/support/types";
import type { TicketListQuery } from "../../src/domain/support/schema";

export interface MessageView {
  id: string;
  author: "customer" | "staff" | "system";
  body: string;
  createdAt: Date;
}

/** What a customer may see of a ticket. No assignee, no internal notes, no staff identities. */
export interface CustomerTicketView {
  number: number;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  orderNumber: number | null;
  createdAt: Date;
  lastMessageAt: Date;
  messages: MessageView[];
}

export type CustomerTicketSummary = Omit<CustomerTicketView, "messages">;

export interface StaffMessageView extends MessageView {
  adminEmail: string | null;
}

export interface StaffNoteView {
  id: string;
  adminEmail: string;
  body: string;
  createdAt: Date;
}

export interface TicketRow {
  id: string;
  number: number;
  customerId: string;
  /** Masked: staff lists never need the full number. */
  customerPhoneMasked: string;
  orderNumber: number | null;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  priority: TicketPriority;
  assignedToId: string | null;
  assignedToEmail: string | null;
  createdAt: Date;
  lastMessageAt: Date;
  lastCustomerMessageAt: Date | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
}

export interface StaffTicketDetail extends TicketRow {
  messages: StaffMessageView[];
  notes: StaffNoteView[];
}

export interface TicketHeader {
  id: string;
  number: number;
  status: TicketStatus;
  resolvedAt: Date | null;
  firstResponseAt: Date | null;
  assignedToId: string | null;
}

export interface FaqItemView {
  slug: string;
  question: string;
  answer: string;
}

export interface FaqCategoryView {
  slug: string;
  title: string;
  items: FaqItemView[];
}

export interface FaqAdminItem extends FaqItemView {
  categorySlug: string;
  position: number;
  published: boolean;
  updatedAt: Date;
}

export interface SupportStore {
  // ---- customer side (every call is scoped by customerId)
  ownedOrderId(customerId: string, orderNumber: number): Promise<string | null>;
  countTicketsSince(customerId: string, since: Date): Promise<number>;
  countUnfinishedTickets(customerId: string): Promise<number>;
  countCustomerMessagesSince(customerId: string, since: Date): Promise<number>;
  hasRecentDuplicate(customerId: string, duplicateKey: string, since: Date): Promise<boolean>;
  createTicket(data: {
    customerId: string;
    orderId: string | null;
    subject: string;
    category: TicketCategory;
    body: string;
    duplicateKey: string;
    now: Date;
  }): Promise<CustomerTicketView>;
  listCustomerTickets(customerId: string, page: number, pageSize: number): Promise<{ items: CustomerTicketSummary[]; total: number }>;
  getCustomerTicket(customerId: string, number: number): Promise<CustomerTicketView | null>;
  /** Header (state) for the customer's own ticket, or null. */
  customerTicketHeader(customerId: string, number: number): Promise<TicketHeader | null>;
  addCustomerMessage(ticketId: string, body: string, status: TicketStatus, now: Date): Promise<void>;
  /** Body of the customer's most recent message on the ticket (reply duplicate check). */
  lastCustomerMessageBody(ticketId: string): Promise<string | null>;
  /** Everything the customer has said and been told, for the data export. Never includes internal notes. */
  exportForCustomer(customerId: string): Promise<unknown[]>;

  // ---- staff side
  listTickets(query: TicketListQuery): Promise<{ items: TicketRow[]; total: number }>;
  getStaffTicket(number: number): Promise<StaffTicketDetail | null>;
  staffTicketHeader(number: number): Promise<TicketHeader | null>;
  addStaffMessage(ticketId: string, adminId: string, body: string, status: TicketStatus, now: Date): Promise<void>;
  addNote(ticketId: string, adminId: string, body: string, now: Date): Promise<void>;
  /** Returns false when the assignee does not exist or is disabled. */
  updateTicket(ticketId: string, patch: { status?: TicketStatus; priority?: TicketPriority; assignedToId?: string | null }, now: Date): Promise<boolean>;
  /** Closes tickets resolved before `before`. Returns how many. */
  closeResolvedBefore(before: Date, now: Date): Promise<number>;
  countByStatus(): Promise<Record<TicketStatus, number>>;

  // ---- FAQ
  listPublishedFaq(): Promise<FaqCategoryView[]>;
  listAllFaq(): Promise<{ categories: Array<{ slug: string; title: string; position: number }>; items: FaqAdminItem[] }>;
  upsertFaqCategory(data: { slug: string; title: string; position: number }): Promise<void>;
  /** False when the category does not exist. */
  upsertFaqItem(data: { categorySlug: string; slug: string; question: string; answer: string; position: number; published: boolean }, now: Date): Promise<boolean>;
  /** Creates the item only if its slug is free; never overwrites an edit. True when created. */
  insertFaqItemIfAbsent(data: { categorySlug: string; slug: string; question: string; answer: string; position: number; published: boolean }, now: Date): Promise<boolean>;
  insertFaqCategoryIfAbsent(data: { slug: string; title: string; position: number }): Promise<void>;
  deleteFaqItem(slug: string): Promise<boolean>;
}

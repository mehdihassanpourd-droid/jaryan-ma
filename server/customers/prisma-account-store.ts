import { REDACTED, scrubShipping, type AddressInput, type NewOrderInput, type ShippingSnapshot } from "../../src/domain/customer/schema";
import { reserveStock, type StockLine } from "../orders/stock";
import { tomanFromDb, tomanToDb } from "../../src/domain/money";
import { Prisma } from "../../src/generated/prisma/client";
import type { Db } from "../db/client";
import { LIST_SELECT, toListRow } from "../catalog/prisma-repository";
import type { AccountStore, AddressRecord, CustomerExportCore, DataRequestType, OrderDeliveryView, OrderView, ShipmentView } from "./account-ports";

// Lines have no position column: a stable, readable order (title, then SKU) instead of random uuid order.
const ORDER_INCLUDE = {
  items: { orderBy: [{ titleSnapshot: "asc" }, { skuSnapshot: "asc" }] },
  statusHistory: { orderBy: { seq: "asc" } },
  shipment: true,
} satisfies Prisma.OrderInclude;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

const toAddress = (a: Prisma.AddressGetPayload<object>): AddressRecord => ({
  id: a.id, label: a.label, recipientName: a.recipientName, recipientPhone: a.recipientPhone, province: a.province, city: a.city,
  street: a.street, plaque: a.plaque, unit: a.unit, postalCode: a.postalCode, notes: a.notes, isDefault: a.isDefault, createdAt: a.createdAt, updatedAt: a.updatedAt,
});

export function deliveryOf(o: Pick<Prisma.OrderGetPayload<object>, "deliveryMethod" | "deliveryDetails">): OrderDeliveryView {
  const d = (o.deliveryDetails ?? {}) as Partial<{ free: boolean; etaMinDays: number | null; etaMaxDays: number | null; note: string | null }>;
  return { method: o.deliveryMethod, free: d.free ?? false, etaMinDays: d.etaMinDays ?? null, etaMaxDays: d.etaMaxDays ?? null, note: d.note ?? null };
}

export function shipmentOf(s: Prisma.OrderShipmentGetPayload<object>): ShipmentView {
  return { carrier: s.carrier as ShipmentView["carrier"], carrierName: s.carrierName, trackingCode: s.trackingCode, updatedAt: s.updatedAt };
}

function toOrder(o: OrderRow): OrderView {
  return {
    number: o.number,
    status: o.status,
    totalToman: tomanFromDb(o.totalToman),
    subtotalToman: tomanFromDb(o.subtotalToman),
    shippingFeeToman: tomanFromDb(o.shippingFeeToman),
    delivery: deliveryOf(o),
    shipment: o.shipment ? shipmentOf(o.shipment) : null,
    placedAt: o.placedAt,
    shipping: o.shipping as unknown as ShippingSnapshot,
    customerNote: o.customerNote,
    items: o.items.map((i) => ({
      productId: i.productId,
      title: i.titleSnapshot,
      sku: i.skuSnapshot,
      variant: (i.variantSnapshot as Record<string, string> | null) ?? null,
      imageKey: i.imageKeySnapshot,
      unitPriceToman: tomanFromDb(i.unitPriceToman),
      quantity: i.quantity,
    })),
    // What the customer may know: the status, when, by whom (customer / staff / system) and the reason staff wrote. Never who.
    history: o.statusHistory.map((e) => ({ status: e.toStatus, at: e.createdAt, reason: e.reason, by: e.actorType })),
  };
}

const ADDRESS_DATA = (input: AddressInput) => ({
  label: input.label, recipientName: input.recipientName, recipientPhone: input.recipientPhone, province: input.province, city: input.city,
  street: input.street, plaque: input.plaque, unit: input.unit, postalCode: input.postalCode, notes: input.notes,
});

const TX = { timeout: 30_000, maxWait: 10_000 };

/** PostgreSQL (Prisma) implementation of the customer account store. */
export class PrismaAccountStore implements AccountStore {
  constructor(private readonly db: Db) {}

  // ---- addresses ----------------------------------------------------------------------------

  async listAddresses(customerId: string) {
    const rows = await this.db.address.findMany({ where: { customerId }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] });
    return rows.map(toAddress);
  }

  async createAddress(customerId: string, input: AddressInput, now: Date) {
    return this.db.$transaction(async (tx) => {
      // Serialise address changes per customer: lock the customer row (a no-op update takes the row lock).
      await tx.customer.update({ where: { id: customerId }, data: { updatedAt: now } });
      const existing = await tx.address.count({ where: { customerId } });
      const makeDefault = input.isDefault || existing === 0;
      if (makeDefault) await tx.address.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } });
      return toAddress(await tx.address.create({ data: { customerId, ...ADDRESS_DATA(input), isDefault: makeDefault, createdAt: now, updatedAt: now } }));
    }, TX);
  }

  async updateAddress(customerId: string, id: string, input: AddressInput, now: Date) {
    return this.db.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: customerId }, data: { updatedAt: now } });
      const current = await tx.address.findFirst({ where: { id, customerId } });
      if (!current) return null;
      const makeDefault = input.isDefault || current.isDefault;
      if (makeDefault && !current.isDefault) await tx.address.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } });
      return toAddress(await tx.address.update({ where: { id }, data: { ...ADDRESS_DATA(input), isDefault: makeDefault, updatedAt: now } }));
    }, TX);
  }

  async deleteAddress(customerId: string, id: string) {
    return this.db.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: customerId }, data: { updatedAt: new Date() } });
      const current = await tx.address.findFirst({ where: { id, customerId } });
      if (!current) return false;
      await tx.address.delete({ where: { id } });
      if (current.isDefault) {
        const next = await tx.address.findFirst({ where: { customerId }, orderBy: { createdAt: "desc" } });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
      return true;
    }, TX);
  }

  async setDefaultAddress(customerId: string, id: string) {
    return this.db.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: customerId }, data: { updatedAt: new Date() } });
      if (!(await tx.address.findFirst({ where: { id, customerId }, select: { id: true } }))) return false;
      await tx.address.updateMany({ where: { customerId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
      await tx.address.update({ where: { id }, data: { isDefault: true } });
      return true;
    }, TX);
  }

  // ---- favourites ---------------------------------------------------------------------------

  async listFavorites(customerId: string, page: number, pageSize: number) {
    const where = { customerId, product: { status: "published" as const } };
    const [rows, total] = await this.db.$transaction([
      this.db.favorite.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: { product: { select: LIST_SELECT } } }),
      this.db.favorite.count({ where }),
    ]);
    return { items: rows.map((r) => toListRow(r.product)), total };
  }

  countFavorites(customerId: string) {
    return this.db.favorite.count({ where: { customerId } });
  }

  async addFavorite(customerId: string, productSlug: string, now: Date) {
    const product = await this.db.product.findFirst({ where: { slug: productSlug, status: "published" }, select: { id: true } });
    if (!product) return "not_found";
    const r = await this.db.favorite.createMany({ data: [{ customerId, productId: product.id, createdAt: now }], skipDuplicates: true });
    return r.count === 1 ? "added" : "exists";
  }

  async removeFavorite(customerId: string, productSlug: string) {
    const r = await this.db.favorite.deleteMany({ where: { customerId, product: { slug: productSlug } } });
    return r.count > 0;
  }

  // ---- orders -------------------------------------------------------------------------------

  async listOrders(customerId: string, page: number, pageSize: number) {
    const [rows, total] = await this.db.$transaction([
      this.db.order.findMany({ where: { customerId }, orderBy: { placedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: ORDER_INCLUDE }),
      this.db.order.count({ where: { customerId } }),
    ]);
    return { items: rows.map(toOrder), total };
  }

  async getOrder(customerId: string, number: number) {
    const row = await this.db.order.findFirst({ where: { customerId, number }, include: ORDER_INCLUDE });
    return row ? toOrder(row) : null;
  }

  async createOrder(input: NewOrderInput, now: Date) {
    const stock: StockLine[] = input.items.filter((i) => i.reserveStock).map((i) => ({ productId: i.productId, sku: i.skuSnapshot, quantity: i.quantity }));
    const row = await this.db.$transaction(async (tx) => {
      // Stock first, in the same transaction as the order: either the order exists AND holds its stock, or neither happened.
      await reserveStock(tx, stock, now);
      const created = await tx.order.create({
        data: {
          customerId: input.customerId,
          totalToman: tomanToDb(input.totalToman),
          subtotalToman: tomanToDb(input.totalToman - input.delivery.feeToman),
          shippingFeeToman: tomanToDb(input.delivery.feeToman),
          deliveryMethod: input.delivery.method,
          deliveryDetails: input.delivery.details as unknown as Prisma.InputJsonValue,
          shipping: input.shipping as unknown as Prisma.InputJsonValue,
          customerNote: input.customerNote,
          requestId: input.requestId,
          placedAt: now,
          updatedAt: now,
          items: {
            create: input.items.map((i) => ({
              productId: i.productId, vendorId: i.vendorId, titleSnapshot: i.titleSnapshot, skuSnapshot: i.skuSnapshot,
              variantSnapshot: i.variantSnapshot === null ? Prisma.JsonNull : (i.variantSnapshot as Prisma.InputJsonValue),
              imageKeySnapshot: i.imageKeySnapshot, unitPriceToman: tomanToDb(i.unitPriceToman), quantity: i.quantity,
              reservedQuantity: i.reserveStock ? i.quantity : 0,
            })),
          },
          statusHistory: { create: { fromStatus: null, toStatus: "pending", actorType: "customer", createdAt: now } },
        },
        include: ORDER_INCLUDE,
      });
      return created;
    }, TX);
    return toOrder(row);
  }

  async findOrderByRequestId(customerId: string, requestId: string) {
    const row = await this.db.order.findFirst({ where: { customerId, requestId }, include: ORDER_INCLUDE });
    return row ? toOrder(row) : null;
  }

  async placeOrderOnce(input: NewOrderInput & { requestId: string }, now: Date) {
    const known = await this.findOrderByRequestId(input.customerId, input.requestId);
    if (known) return { order: known, created: false };
    try {
      return { order: await this.createOrder(input, now), created: true };
    } catch (error) {
      // A retry that raced the original: the unique (customerId, requestId) index lets only one through; return that one.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.findOrderByRequestId(input.customerId, input.requestId);
        if (winner) return { order: winner, created: false };
      }
      throw error;
    }
  }

  // ---- data requests, export, deletion ---------------------------------------------------------

  async recordDataRequest(customerId: string, type: DataRequestType, now: Date) {
    return (await this.db.customerDataRequest.create({ data: { customerId, type, requestedAt: now }, select: { id: true } })).id;
  }

  async completeDataRequest(id: string, now: Date) {
    await this.db.customerDataRequest.update({ where: { id }, data: { status: "completed", completedAt: now } });
  }

  async lastDataRequestAt(customerId: string, type: DataRequestType) {
    const row = await this.db.customerDataRequest.findFirst({ where: { customerId, type }, orderBy: { requestedAt: "desc" }, select: { requestedAt: true } });
    return row?.requestedAt ?? null;
  }

  async gatherExport(customerId: string): Promise<CustomerExportCore | null> {
    const c = await this.db.customer.findUnique({ where: { id: customerId } });
    if (!c) return null;
    const [addresses, favorites, orders, sessions] = await Promise.all([
      this.db.address.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } }),
      this.db.favorite.findMany({ where: { customerId }, orderBy: { createdAt: "asc" }, select: { createdAt: true, product: { select: { slug: true, name: true } } } }),
      this.db.order.findMany({ where: { customerId }, orderBy: { placedAt: "asc" }, include: ORDER_INCLUDE }),
      this.db.customerSession.aggregate({ where: { customerId, expiresAt: { gt: new Date() } }, _count: true, _max: { lastSeenAt: true } }),
    ]);
    return {
      profile: {
        phone: c.phone, firstName: c.firstName, lastName: c.lastName, email: c.email, status: c.status, marketingOptIn: c.marketingOptIn,
        termsVersion: c.termsVersion, termsAcceptedAt: c.termsAcceptedAt, phoneVerifiedAt: c.phoneVerifiedAt, createdAt: c.createdAt, lastLoginAt: c.lastLoginAt,
      },
      addresses: addresses.map(toAddress),
      favorites: favorites.map((f) => ({ slug: f.product.slug, name: f.product.name, addedAt: f.createdAt })),
      orders: orders.map(toOrder),
      activeSessions: { count: sessions._count, lastSeenAt: sessions._max.lastSeenAt },
    };
  }

  countOpenOrders(customerId: string) {
    return this.db.order.count({ where: { customerId, status: { in: ["pending", "confirmed", "preparing", "shipped"] } } });
  }

  async requestDeletion(customerId: string, now: Date, scheduledAt: Date, keepSessionId?: string) {
    await this.db.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: customerId }, data: { status: "pending_deletion", deletionRequestedAt: now, deletionScheduledAt: scheduledAt, updatedAt: now } });
      await tx.customerSession.deleteMany({ where: { customerId, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) } });
      await tx.customerDataRequest.create({ data: { customerId, type: "deletion", requestedAt: now } });
    }, TX);
  }

  async cancelDeletion(customerId: string, now: Date) {
    return this.db.$transaction(async (tx) => {
      const r = await tx.customer.updateMany({ where: { id: customerId, status: "pending_deletion" }, data: { status: "active", deletionRequestedAt: null, deletionScheduledAt: null, updatedAt: now } });
      if (r.count === 0) return false;
      await tx.customerDataRequest.updateMany({ where: { customerId, type: "deletion", status: "requested" }, data: { status: "cancelled", completedAt: now } });
      return true;
    }, TX);
  }

  async listDueDeletions(now: Date, limit: number) {
    const rows = await this.db.customer.findMany({ where: { status: "pending_deletion", deletionScheduledAt: { lte: now } }, orderBy: { deletionScheduledAt: "asc" }, take: limit, select: { id: true } });
    return rows.map((r) => r.id);
  }

  async anonymize(customerId: string, now: Date) {
    return this.db.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true, phone: true, status: true } });
      if (!customer || customer.status === "anonymized") return false;

      await tx.customerOtp.deleteMany({ where: { phone: customer.phone } });
      await tx.customerSession.deleteMany({ where: { customerId } });
      await tx.address.deleteMany({ where: { customerId } });
      await tx.favorite.deleteMany({ where: { customerId } });

      // Orders are kept (accounting), minus the personal parts of the delivery snapshot.
      const orders = await tx.order.findMany({ where: { customerId }, select: { id: true, shipping: true } });
      for (const order of orders) {
        await tx.order.update({ where: { id: order.id }, data: { shipping: scrubShipping(order.shipping) as unknown as Prisma.InputJsonValue, customerNote: null } });
        // a reason written by staff may mention the customer: keep that the order was refused/cancelled, not why
        await tx.orderStatusEvent.updateMany({ where: { orderId: order.id, reason: { not: null } }, data: { reason: null } });
      }

      // Support conversations: keep the fact that a ticket existed (category, status, dates), drop what was said.
      const tickets = await tx.supportTicket.findMany({ where: { customerId }, select: { id: true } });
      const ticketIds = tickets.map((t) => t.id);
      if (ticketIds.length > 0) {
        await tx.supportMessage.updateMany({ where: { ticketId: { in: ticketIds } }, data: { body: REDACTED } });
        await tx.supportNote.updateMany({ where: { ticketId: { in: ticketIds } }, data: { body: REDACTED } });
        await tx.supportTicket.updateMany({ where: { id: { in: ticketIds } }, data: { subject: REDACTED, duplicateKey: null } });
      }

      // The tombstone frees the phone number for a future registration.
      await tx.customer.update({
        where: { id: customerId },
        data: { phone: `deleted:${customerId}`, firstName: null, lastName: null, email: null, marketingOptIn: false, status: "anonymized", anonymizedAt: now, deletionScheduledAt: null, updatedAt: now },
      });
      await tx.customerDataRequest.updateMany({ where: { customerId, type: "deletion", status: "requested" }, data: { status: "completed", completedAt: now } });
      await tx.auditLog.create({ data: { actorEmail: "system", action: "customer.anonymized", entity: "customer", entityId: customerId, detail: { orders: orders.length, tickets: ticketIds.length }, at: now } });
      return true;
    }, TX);
  }
}

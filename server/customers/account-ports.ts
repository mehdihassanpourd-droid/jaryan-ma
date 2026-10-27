import type { ProductListRow } from "../../src/domain/product/types";
import type { AddressInput, NewOrderInput, ShippingSnapshot } from "../../src/domain/customer/schema";

/** Customer-facing data other than sign-in: addresses, favourites, orders, data requests. */
export interface AddressRecord {
  id: string;
  label: string | null;
  recipientName: string;
  recipientPhone: string;
  province: string;
  city: string;
  street: string;
  plaque: string | null;
  unit: string | null;
  postalCode: string;
  notes: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItemView {
  productId: string;
  title: string;
  sku: string | null;
  variant: Record<string, string> | null;
  imageKey: string | null;
  /** Whole Toman (exact: see src/domain/money.ts). */
  unitPriceToman: number;
  quantity: number;
}

export interface OrderView {
  number: number;
  status: "pending" | "confirmed" | "preparing" | "shipped" | "delivered" | "cancelled";
  totalToman: number;
  placedAt: Date;
  shipping: ShippingSnapshot;
  customerNote: string | null;
  items: OrderItemView[];
}

export type DataRequestType = "export" | "deletion";

export interface CustomerExportCore {
  profile: {
    phone: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    status: string;
    marketingOptIn: boolean;
    termsVersion: string;
    termsAcceptedAt: Date;
    phoneVerifiedAt: Date;
    createdAt: Date;
    lastLoginAt: Date | null;
  };
  addresses: AddressRecord[];
  favorites: Array<{ slug: string; name: string; addedAt: Date }>;
  orders: OrderView[];
  activeSessions: { count: number; lastSeenAt: Date | null };
}

export interface AccountStore {
  listAddresses(customerId: string): Promise<AddressRecord[]>;
  /** Creates an address; the first one, or one flagged default, becomes the single default. */
  createAddress(customerId: string, input: AddressInput, now: Date): Promise<AddressRecord>;
  /** Null when the address does not exist or belongs to someone else. */
  updateAddress(customerId: string, id: string, input: AddressInput, now: Date): Promise<AddressRecord | null>;
  /** Deleting the default promotes the newest remaining address. False when not found. */
  deleteAddress(customerId: string, id: string): Promise<boolean>;
  setDefaultAddress(customerId: string, id: string): Promise<boolean>;

  listFavorites(customerId: string, page: number, pageSize: number): Promise<{ items: ProductListRow[]; total: number }>;
  countFavorites(customerId: string): Promise<number>;
  /** Only published products can be favourited. */
  addFavorite(customerId: string, productSlug: string, now: Date): Promise<"added" | "exists" | "not_found">;
  removeFavorite(customerId: string, productSlug: string): Promise<boolean>;

  listOrders(customerId: string, page: number, pageSize: number): Promise<{ items: OrderView[]; total: number }>;
  getOrder(customerId: string, number: number): Promise<OrderView | null>;
  /** Inserts an order exactly as given (totals already validated by `newOrderSchema`). */
  createOrder(input: NewOrderInput, now: Date): Promise<OrderView>;
  /** The order a checkout attempt already created, if any. */
  findOrderByRequestId(customerId: string, requestId: string): Promise<OrderView | null>;
  /**
   * Checkout: creates the order unless this customer already placed one with the same `requestId`, in which case that
   * order is returned (`created: false`). Safe against a retry racing the original request.
   */
  placeOrderOnce(input: NewOrderInput & { requestId: string }, now: Date): Promise<{ order: OrderView; created: boolean }>;

  recordDataRequest(customerId: string, type: DataRequestType, now: Date): Promise<string>;
  completeDataRequest(id: string, now: Date): Promise<void>;
  lastDataRequestAt(customerId: string, type: DataRequestType): Promise<Date | null>;
  gatherExport(customerId: string): Promise<CustomerExportCore | null>;

  /** Orders that are not yet delivered or cancelled (deletion is refused while any exist). */
  countOpenOrders(customerId: string): Promise<number>;
  /** Marks the account for deletion and signs out every other session. */
  requestDeletion(customerId: string, now: Date, scheduledAt: Date, keepSessionId?: string): Promise<void>;
  cancelDeletion(customerId: string, now: Date): Promise<boolean>;
  listDueDeletions(now: Date, limit: number): Promise<string[]>;
  /** Irreversibly removes personal data. See docs/customers/CUSTOMERS.md for exactly what is kept. */
  anonymize(customerId: string, now: Date): Promise<boolean>;
}

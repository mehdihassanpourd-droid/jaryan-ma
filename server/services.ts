import { createShippingAdminRoutes } from "./routes/admin-shipping";
import { ShipmentNotifier } from "./notifications/shipment-notifier";
import { PrismaShippingConfigStore } from "./shipping/config-store";
import { ManualRatesProvider } from "./shipping/manual-provider";
import { ShippingService } from "./shipping/service";
import { hkdfSync } from "node:crypto";
import type { SecurityFacts } from "../src/domain/maintenance/security-checks";
import { DEFAULT_OTP_POLICY, type OtpPolicy } from "../src/domain/customer/otp-policy";
import type { RateLimiter } from "./auth/rate-limit";
import type { CookieSettings } from "./auth/session";
import type { CatalogRepository } from "../src/domain/product/ports";
import { AccountService, DEFAULT_ACCOUNT_SETTINGS } from "./customers/account-service";
import { CheckoutService } from "./customers/checkout-service";
import { CustomerAuthService, CustomerSessionAuthenticator, DEFAULT_CUSTOMER_AUTH, type CustomerAuthSettings } from "./customers/customer-auth";
import { OtpService } from "./customers/otp-service";
import { PrismaAccountStore } from "./customers/prisma-account-store";
import { PrismaCustomerStore } from "./customers/prisma-store";
import type { Db } from "./db/client";
import { PrismaMaintenanceStore } from "./maintenance/prisma-store";
import { MaintenanceService, type HealthProbes, type MaintenanceSettings, DEFAULT_MAINTENANCE_SETTINGS } from "./maintenance/service";
import { createMaintenanceAdminRoutes } from "./routes/admin-maintenance";
import { createOrderAdminRoutes } from "./routes/admin-orders";
import { OrderAdminService } from "./orders/order-admin";
import { OrderLifecycleService } from "./orders/order-lifecycle";
import { createSupportAdminRoutes } from "./routes/admin-support";
import type { SmsProvider } from "./sms/provider";
import { PrismaSupportStore } from "./support/prisma-store";
import { SupportService } from "./support/service";
import type { AdminRouter } from "./api";

/** Separate keys for separate purposes, all derived from the one server secret. */
export function deriveKey(master: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `jaryan-ma/${purpose}/v1`, 32));
}

export interface PlatformOptions {
  db: Db;
  /** 32-byte server secret (APP_ENCRYPTION_KEY). */
  masterKey: Buffer;
  sms: SmsProvider;
  limiter: RateLimiter;
  customerCookie: CookieSettings;
  /** Checkout reads published products (prices, stock) from here, never from the browser. */
  catalog: Pick<CatalogRepository, "getPublishedBySlugs">;
  vendorId: string;
  /** Called after orders move stock (placed, rejected, cancelled) with the affected product ids, so the app can refresh their public availability. */
  onStockChanged?: (productIds: string[]) => void;
  clock?: () => Date;
  /** Tracking SMS when an order ships. Off unless the owner enables it (SHIPMENT_SMS_ENABLED); never on in production without a real gateway. */
  shipmentSms?: boolean;
  /** Runs work that must not block a request (sending an SMS after an order change). */
  background?: (task: Promise<unknown>) => void;
  log?: (event: string, detail?: Record<string, unknown>) => void;
  otpPolicy?: OtpPolicy;
  customerAuth?: Partial<CustomerAuthSettings>;
  maintenance?: Partial<MaintenanceSettings>;
  probes: Omit<HealthProbes, "overdueDeletions">;
}

/** Wires customers, support and maintenance on top of one database. Shared by the server and the tests. */
export function createPlatformServices(o: PlatformOptions) {
  const clock = o.clock ?? (() => new Date());
  const customerStore = new PrismaCustomerStore(o.db);
  const accountStore = new PrismaAccountStore(o.db);
  const supportStore = new PrismaSupportStore(o.db);
  const maintenanceStore = new PrismaMaintenanceStore(o.db);

  const authSettings = { ...DEFAULT_CUSTOMER_AUTH, ...o.customerAuth };
  const otp = new OtpService(customerStore, o.sms, deriveKey(o.masterKey, "otp"), o.otpPolicy ?? DEFAULT_OTP_POLICY, clock, o.log);
  const customerAuth = new CustomerAuthService(customerStore, otp, o.limiter, authSettings, clock);
  const customerAuthenticator = new CustomerSessionAuthenticator(customerStore, o.customerCookie, { idleMs: authSettings.sessionIdleMs }, clock);

  const support = new SupportService(supportStore, o.limiter, (entry) => adminAudit(o.db, entry), undefined, clock);
  const accounts = new AccountService(accountStore, customerStore, DEFAULT_ACCOUNT_SETTINGS, clock, (customerId) => support.exportForCustomer(customerId));
  const onStockChanged = o.onStockChanged ?? (() => undefined);
  const shippingConfig = new PrismaShippingConfigStore(o.db);
  const shipping = new ShippingService([new ManualRatesProvider(shippingConfig)], shippingConfig, o.log);
  const checkout = new CheckoutService(o.catalog, accountStore, customerStore, shipping, o.vendorId, clock, onStockChanged);
  const shipmentNotifier = new ShipmentNotifier(o.db, o.sms, { enabled: o.shipmentSms ?? false, ...(o.background ? { background: o.background } : {}), clock, ...(o.log ? { log: (event, detail) => o.log?.(event, detail) } : {}) });
  const orderLifecycle = new OrderLifecycleService(o.db, onStockChanged, clock, shipmentNotifier);
  const orderAdmin = new OrderAdminService(o.db, shipmentNotifier.enabled);
  const maintenance = new MaintenanceService(
    maintenanceStore,
    { ...o.probes, overdueDeletions: async () => (await accountStore.listDueDeletions(new Date(clock().getTime() - 24 * 3600_000), 1000)).length },
    { ...DEFAULT_MAINTENANCE_SETTINGS, ...o.maintenance },
    clock,
  );

  const adminRoutes: AdminRouter[] = [createSupportAdminRoutes(support), createMaintenanceAdminRoutes(maintenance), createOrderAdminRoutes(orderAdmin, orderLifecycle, shipmentNotifier), createShippingAdminRoutes(shippingConfig, clock)];
  return { shipmentNotifier, shippingConfig, shipping, customerStore, accountStore, supportStore, maintenanceStore, customerAuth, customerAuthenticator, support, accounts, checkout, orderLifecycle, orderAdmin, maintenance, adminRoutes };
}

export type PlatformServices = ReturnType<typeof createPlatformServices>;

async function adminAudit(db: Db, entry: { actorEmail: string; action: string; entity: string; entityId: string; detail?: Record<string, unknown>; at: Date }) {
  await db.auditLog.create({ data: { actorEmail: entry.actorEmail, action: entry.action, entity: entry.entity, entityId: entry.entityId, detail: (entry.detail ?? {}) as object, at: entry.at } });
}

export type { SecurityFacts };

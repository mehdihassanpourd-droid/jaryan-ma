import { tomanFromDb, tomanFromDbOrNull, tomanToDb, tomanToDbOrNull } from "../../src/domain/money";
import type { ShippingConfigInput, ShippingConfigJson } from "../../src/domain/shipping/config";
import { SHIPPING_METHODS } from "../../src/domain/shipping/methods";
import type { MethodRules, WeightSettings } from "../../src/domain/shipping/pricing";
import type { Db } from "../db/client";

export class ShippingConfigConflictError extends Error {
  constructor() {
    super("shipping_config_changed");
  }
}

export interface ShippingConfigStore {
  /** The whole table as the admin screen edits it. */
  load(): Promise<ShippingConfigJson>;
  /** Replaces the table if `expectedVersion` is still current (otherwise `ShippingConfigConflictError`). Returns the new table. */
  save(input: ShippingConfigInput, actorEmail: string, now: Date): Promise<ShippingConfigJson>;
}

/** PostgreSQL (Prisma) implementation. Reads and writes the whole table in one transaction each. */
export class PrismaShippingConfigStore implements ShippingConfigStore {
  constructor(private readonly db: Db) {}

  async load(): Promise<ShippingConfigJson> {
    const [settings, configs] = await Promise.all([
      this.db.shippingSettings.findUnique({ where: { id: 1 } }),
      this.db.shippingMethodConfig.findMany({ include: { rates: { orderBy: { position: "asc" } } } }),
    ]);
    // A database that predates the migration seed (never in practice) still yields a valid, all-disabled table.
    const s = settings ?? { defaultItemWeightGrams: 500, packagingWeightGrams: 0, version: 1 };
    const byMethod = new Map(configs.map((c) => [c.method, c]));
    return {
      version: s.version,
      defaultItemWeightGrams: s.defaultItemWeightGrams,
      packagingWeightGrams: s.packagingWeightGrams,
      methods: SHIPPING_METHODS.map((method) => {
        const c = byMethod.get(method);
        return {
          method,
          enabled: c?.enabled ?? false,
          freeThresholdToman: tomanFromDbOrNull(c?.freeThresholdToman ?? null),
          etaMinDays: c?.etaMinDays ?? null,
          etaMaxDays: c?.etaMaxDays ?? null,
          note: c?.note ?? null,
          rates: (c?.rates ?? []).map((r) => ({
            id: r.id,
            provinces: r.provinces,
            cities: r.cities,
            minWeightGrams: r.minWeightGrams,
            maxWeightGrams: r.maxWeightGrams,
            priceToman: tomanFromDb(r.priceToman),
          })),
        };
      }),
    };
  }

  async save(input: ShippingConfigInput, actorEmail: string, now: Date): Promise<ShippingConfigJson> {
    await this.db.$transaction(
      async (tx) => {
        await tx.shippingSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
        const claimed = await tx.shippingSettings.updateMany({
          where: { id: 1, version: input.expectedVersion },
          data: { defaultItemWeightGrams: input.defaultItemWeightGrams, packagingWeightGrams: input.packagingWeightGrams, version: { increment: 1 }, updatedAt: now },
        });
        if (claimed.count !== 1) throw new ShippingConfigConflictError();
        // Methods the screen did not send keep what they have (it sends all four).
        for (const m of input.methods) {
          const data = { enabled: m.enabled, freeThresholdToman: tomanToDbOrNull(m.freeThresholdToman), etaMinDays: m.etaMinDays, etaMaxDays: m.etaMaxDays, note: m.note };
          await tx.shippingMethodConfig.upsert({ where: { method: m.method }, create: { method: m.method, ...data }, update: data });
          await tx.shippingRate.deleteMany({ where: { method: m.method } });
          if (m.rates.length > 0) {
            await tx.shippingRate.createMany({
              data: m.rates.map((r, position) => ({
                method: m.method,
                position,
                provinces: r.provinces,
                cities: r.cities,
                minWeightGrams: r.minWeightGrams,
                maxWeightGrams: r.maxWeightGrams,
                priceToman: tomanToDb(r.priceToman),
              })),
            });
          }
        }
        await tx.auditLog.create({
          data: {
            actorEmail,
            action: "shipping.config",
            entity: "shipping",
            entityId: "config",
            // Counts and switches only; prices are in the table itself.
            detail: { methods: input.methods.map((m) => ({ method: m.method, enabled: m.enabled, rates: m.rates.length })), version: input.expectedVersion + 1 },
            at: now,
          },
        });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    return this.load();
  }
}

export const toRules = (config: ShippingConfigJson): { rules: MethodRules[]; weight: WeightSettings } => ({
  weight: { defaultItemWeightGrams: config.defaultItemWeightGrams, packagingWeightGrams: config.packagingWeightGrams },
  rules: config.methods.map((m) => ({
    method: m.method,
    enabled: m.enabled,
    freeThresholdToman: m.freeThresholdToman,
    etaMinDays: m.etaMinDays,
    etaMaxDays: m.etaMaxDays,
    note: m.note,
    rates: m.rates,
  })),
});

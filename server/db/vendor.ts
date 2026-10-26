import type { Db } from "./client";

export const DEFAULT_VENDOR_SLUG = "jaryan-ma";

/**
 * Single-vendor phase: every product belongs to the gallery's own platform vendor.
 * Keeps the schema marketplace-ready without any multi-vendor behaviour yet.
 */
export async function ensureDefaultVendor(db: Db): Promise<string> {
  const vendor = await db.vendor.upsert({
    where: { slug: DEFAULT_VENDOR_SLUG },
    update: {},
    create: { slug: DEFAULT_VENDOR_SLUG, name: "جریان ما", kind: "PLATFORM", status: "ACTIVE", instagram: "jaryan.ma" },
    select: { id: true },
  });
  return vendor.id;
}

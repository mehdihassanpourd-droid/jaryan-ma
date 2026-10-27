import { z } from "zod";

/**
 * Validation of the public snapshot files (the shapes in `snapshot.ts`) by their READERS: the static storefront at
 * build time (`src/seo/catalog-source.ts`) and in the shopper's browser (`src/lib/live-catalog.ts`). Anything that
 * does not match is rejected, never rendered.
 */
const slug = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u, "invalid_slug");
const toman = z.number().int().min(0).max(1_000_000_000_000_000).nullable();
const availability = z.enum(["in_stock", "sold_out", "made_to_order"]);
const fulfillment = z.enum(["unique", "stocked", "made_to_order"]);
const image = z.object({ url: z.string().min(1).max(2000), alt: z.string().max(500) });

export const publicProductSchema = z.object({
  slug,
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10_000),
  // Older snapshot files predate these fields: absent = generated automatically.
  seoTitle: z.string().max(200).nullish().transform((v) => v ?? null),
  seoDescription: z.string().max(400).nullish().transform((v) => v ?? null),
  category: z.object({ slug, name: z.string().trim().min(1).max(200) }).nullable(),
  fulfillment,
  priceToman: toman,
  availability,
  leadTimeDays: z.number().int().min(1).max(365).nullable(),
  images: z.array(image).max(50),
  variants: z
    .array(z.object({ sku: z.string().max(100), options: z.record(z.string(), z.string()), priceToman: toman, available: z.boolean() }))
    .max(100),
});

export const manifestSchema = z.object({ version: z.number(), categories: z.array(z.object({ slug, name: z.string(), count: z.number() })) });
export const shardSchema = z.object({ products: z.array(z.object({ slug })) });

export const publicCardSchema = z.object({
  slug,
  name: z.string().trim().min(1).max(200),
  fulfillment,
  priceToman: toman,
  priceFromToman: toman.optional().transform((v) => v ?? null),
  availability,
  cover: image.nullable(),
});
export const cardShardSchema = z.object({ products: z.array(publicCardSchema).max(1000) });

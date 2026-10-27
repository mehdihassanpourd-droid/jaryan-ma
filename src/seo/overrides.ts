import { z } from "zod";
import { cleanText } from "./text";

/**
 * Human-APPROVED title/description improvements kept in the repository (`seo/overrides.json`). The automated SEO system only ever
 * PROPOSES entries (a pull request, built from verified catalogue facts by `tools/seo-growth`); they take effect when a person merges
 * that pull request. An editor's own SEO text in the admin always wins over an entry here; an entry wins over the generated text.
 */
export const OVERRIDE_TITLE_MAX = 70;
export const OVERRIDE_DESCRIPTION_MAX = 160;

const entrySchema = z
  .object({
    title: z.string().trim().min(5).max(OVERRIDE_TITLE_MAX).optional(),
    description: z.string().trim().min(30).max(OVERRIDE_DESCRIPTION_MAX).optional(),
  })
  .strict()
  .refine((e) => e.title !== undefined || e.description !== undefined, "empty_entry");

export const overridesSchema = z.object({ version: z.literal(1), products: z.record(z.string().min(1).max(100), entrySchema) }).strict();
export type SeoOverrides = z.output<typeof overridesSchema>;
export type SeoOverride = SeoOverrides["products"][string];

export const NO_OVERRIDES: SeoOverrides = { version: 1, products: {} };

/** Parses the file's text; anything invalid is an error (a broken approved file must fail the build, not silently vanish). */
export function parseOverrides(text: string): SeoOverrides {
  const parsed = overridesSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`seo/overrides.json is invalid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return { version: 1, products: Object.fromEntries(Object.entries(parsed.data.products).map(([slug, e]) => [slug, { ...(e.title ? { title: cleanText(e.title) } : {}), ...(e.description ? { description: cleanText(e.description) } : {}) }])) };
}

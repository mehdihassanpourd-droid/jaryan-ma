import { MAX_IMAGES_PER_PRODUCT, validateProductInput, type ValidationIssue } from "@/domain/product/schema";
import type { Fulfillment, ProductStatus, StoredProduct } from "@/domain/product/types";
import { issueMessage } from "./errors";
import { countToInput, parsePrice, parseWhole, priceToInput } from "./money";

export const FULFILLMENT_LABELS: Record<Fulfillment, string> = {
  unique: "اثر یگانه (یک‌تکه)",
  stocked: "موجودی‌دار (از پیش ساخته‌شده)",
  made_to_order: "سفارشی (ساخت پس از سفارش)",
};
export const STATUS_LABELS: Record<ProductStatus, string> = { draft: "پیش‌نویس", published: "منتشرشده", archived: "بایگانی‌شده" };
export const MAX_OPTION_NAMES = 3;
export { MAX_IMAGES_PER_PRODUCT };

export interface VariantForm {
  /** Client-side identity only (never sent). */
  id: string;
  sku: string;
  values: string[];
  price: string;
  inventory: string;
}

export interface ImageForm {
  key: string;
  alt: string;
}

/** Everything the editor shows, as text: numbers are parsed (exactly) only when the form is turned into an API body. */
export interface ProductForm {
  name: string;
  slug: string;
  description: string;
  categoryId: string;
  fulfillment: Fulfillment;
  price: string;
  inventory: string;
  leadTimeDays: string;
  seoTitle: string;
  seoDescription: string;
  optionNames: string[];
  variants: VariantForm[];
  images: ImageForm[];
  status: ProductStatus;
}

let counter = 0;
export const newVariantId = () => `v${++counter}`;

export function emptyForm(): ProductForm {
  return {
    name: "",
    slug: "",
    description: "",
    categoryId: "",
    fulfillment: "unique",
    price: "",
    inventory: "1",
    leadTimeDays: "",
    seoTitle: "",
    seoDescription: "",
    optionNames: [],
    variants: [],
    images: [],
    status: "draft",
  };
}

export function fromStored(p: StoredProduct): ProductForm {
  const variants = [...p.variants].sort((a, b) => a.position - b.position);
  const optionNames = Object.keys(variants[0]?.options ?? {});
  return {
    name: p.name,
    slug: p.slug,
    description: p.description,
    categoryId: p.categoryId ?? "",
    fulfillment: p.fulfillment,
    price: priceToInput(p.priceToman),
    inventory: countToInput(p.inventory),
    leadTimeDays: countToInput(p.leadTimeDays),
    seoTitle: p.seoTitle ?? "",
    seoDescription: p.seoDescription ?? "",
    optionNames,
    variants: variants.map((v) => ({
      id: newVariantId(),
      sku: v.sku,
      values: optionNames.map((n) => v.options[n] ?? ""),
      price: priceToInput(v.priceToman),
      inventory: countToInput(v.inventory),
    })),
    images: [...p.images].sort((a, b) => a.position - b.position).map((i) => ({ key: i.key, alt: i.alt })),
    status: p.status,
  };
}

/** Stable text of the form, used to detect unsaved changes. */
export const serializeForm = (form: ProductForm): string => JSON.stringify({ ...form, variants: form.variants.map((v) => ({ sku: v.sku, values: v.values, price: v.price, inventory: v.inventory })) });

export type FieldErrors = Record<string, string>;

const LOCAL_MESSAGES = {
  invalid: "عدد معتبر وارد کنید (فقط رقم؛ اعشار و علامت مجاز نیست).",
  too_large: "عدد از حداکثر مجاز بزرگ‌تر است.",
} as const;

/**
 * Turns the form into the API body. Numbers are parsed with BigInt-exact rules (see money.ts); anything that is not a
 * valid whole number is reported against its own field instead of being coerced.
 */
export function toBody(form: ProductForm, status: ProductStatus = form.status): { body: Record<string, unknown>; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const num = (path: string, text: string, kind: "price" | "count", max = 100_000): number | null => {
    const r = kind === "price" ? parsePrice(text) : parseWhole(text, max);
    if (!r.ok) {
      errors[path] = LOCAL_MESSAGES[r.reason];
      return null;
    }
    return r.value;
  };

  const withVariants = form.fulfillment !== "unique" && form.variants.length > 0;
  const names = form.optionNames.map((n) => n.trim());
  const variants = withVariants
    ? form.variants.map((v, i) => {
        const options: Record<string, string> = {};
        names.forEach((name, k) => {
          if (name) options[name] = (v.values[k] ?? "").trim();
        });
        if (names.some((n) => !n) || Object.values(options).some((x) => x === "")) errors[`variants.${i}.options`] = "نام و مقدار همه ویژگی‌ها را وارد کنید.";
        return {
          sku: v.sku.trim(),
          options,
          priceToman: num(`variants.${i}.priceToman`, v.price, "price"),
          inventory: form.fulfillment === "stocked" ? num(`variants.${i}.inventory`, v.inventory, "count") : null,
        };
      })
    : [];

  const inventory =
    form.fulfillment === "made_to_order" || withVariants ? null : num("inventory", form.inventory, "count", form.fulfillment === "unique" ? 1 : 100_000);

  const body: Record<string, unknown> = {
    ...(form.slug.trim() ? { slug: form.slug.trim() } : {}),
    name: form.name,
    description: form.description,
    categoryId: form.categoryId || null,
    status,
    fulfillment: form.fulfillment,
    priceToman: num("priceToman", form.price, "price"),
    inventory,
    leadTimeDays: form.fulfillment === "made_to_order" ? num("leadTimeDays", form.leadTimeDays, "count", 365) : null,
    images: form.images.map((i) => ({ key: i.key, alt: i.alt })),
    variants,
    seoTitle: form.seoTitle,
    seoDescription: form.seoDescription,
  };
  return { body, errors };
}

/** `variants.2.options.size` -> `variants.2.options`; the first message per field wins. */
export function issuesToErrors(issues: ValidationIssue[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const parts = issue.path.split(".");
    const path = parts[0] === "variants" && parts[2] === "options" ? parts.slice(0, 3).join(".") : issue.path || "form";
    if (!(path in errors)) errors[path] = issueMessage(issue);
  }
  return errors;
}

export function validateForm(form: ProductForm, status: ProductStatus = form.status): { ok: true; body: Record<string, unknown> } | { ok: false; errors: FieldErrors } {
  const { body, errors } = toBody(form, status);
  const checked = validateProductInput(body);
  const merged: FieldErrors = checked.ok ? {} : issuesToErrors(checked.issues);
  // Local number errors are more precise than what the schema can say about a coerced null.
  for (const [path, message] of Object.entries(errors)) merged[path] = message;
  return Object.keys(merged).length === 0 ? { ok: true, body } : { ok: false, errors: merged };
}

/** The first problem to scroll to / announce. */
export const firstError = (errors: FieldErrors): [string, string] | null => Object.entries(errors)[0] ?? null;

/** A copy of a product as a new DRAFT: same content and images, new SKUs, no SEO overrides, no slug (the server derives a unique one). */
export function duplicateBody(p: StoredProduct, attempt = 1): Record<string, unknown> {
  const suffix = `-copy${attempt > 1 ? attempt : ""}`;
  const name = `${p.name} (کپی)`;
  return {
    name: name.length > 120 ? `${p.name.slice(0, 108)} (کپی)` : name,
    description: p.description,
    categoryId: p.categoryId,
    status: "draft",
    fulfillment: p.fulfillment,
    priceToman: p.priceToman,
    inventory: p.inventory,
    leadTimeDays: p.leadTimeDays,
    seoTitle: null,
    seoDescription: null,
    images: [...p.images].sort((a, b) => a.position - b.position).map((i) => ({ key: i.key, alt: i.alt })),
    variants: [...p.variants]
      .sort((a, b) => a.position - b.position)
      .map((v) => ({ sku: `${v.sku.slice(0, 64 - suffix.length)}${suffix}`, options: v.options, priceToman: v.priceToman, inventory: v.inventory })),
  };
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

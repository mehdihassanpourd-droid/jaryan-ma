import { IRAN_PROVINCES } from "@/domain/customer/geo";
import { shippingInputSchema, type ShippingInput } from "@/domain/customer/schema";
import type { ApiAddress } from "./order-api";

/** What the shopper types, as text (nothing is parsed or normalised until validation). */
export interface ShippingForm {
  recipientName: string;
  recipientPhone: string;
  province: string;
  city: string;
  street: string;
  plaque: string;
  unit: string;
  postalCode: string;
  customerNote: string;
}

export const emptyShippingForm = (): ShippingForm => ({ recipientName: "", recipientPhone: "", province: "", city: "", street: "", plaque: "", unit: "", postalCode: "", customerNote: "" });

export type ShippingErrors = Partial<Record<keyof ShippingForm, string>>;

const MESSAGES: Record<keyof ShippingForm, string> = {
  recipientName: "نام و نام خانوادگی گیرنده را بنویسید (دست‌کم ۲ نویسه).",
  recipientPhone: "شمارهٔ موبایل معتبر نیست؛ مثل ۰۹۱۲۳۴۵۶۷۸۹ بنویسید.",
  province: "استان را انتخاب کنید.",
  city: "شهر را بنویسید.",
  street: "نشانی کامل را بنویسید (دست‌کم ۵ نویسه).",
  plaque: "پلاک حداکثر ۱۰ نویسه است.",
  unit: "واحد حداکثر ۱۰ نویسه است.",
  postalCode: "کد پستی ۱۰ رقمی معتبر نیست.",
  customerNote: "توضیحات حداکثر ۳۰۰ نویسه است.",
};

export type ShippingResult = { ok: true; shipping: ShippingInput; customerNote: string | null } | { ok: false; errors: ShippingErrors };

/** The SAME rules the server applies (shared schema), with Persian messages per field. */
export function validateShipping(form: ShippingForm): ShippingResult {
  const { customerNote: _note, ...delivery } = form;
  void _note;
  const parsed = shippingInputSchema.safeParse(delivery);
  const errors: ShippingErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as keyof ShippingForm | undefined;
      if (field && field in MESSAGES && !errors[field]) errors[field] = MESSAGES[field];
    }
  }
  const note = form.customerNote.trim();
  if (note.length > 300) errors.customerNote = MESSAGES.customerNote;
  if (!parsed.success || errors.customerNote) return { ok: false, errors };
  return { ok: true, shipping: parsed.data, customerNote: note === "" ? null : note };
}

/** +989121234567 -> 09121234567 (how people write their number). */
export const localPhone = (e164: string): string => (e164.startsWith("+98") ? `0${e164.slice(3)}` : e164);

export function formFromAddress(address: ApiAddress): ShippingForm {
  return {
    recipientName: address.recipientName,
    recipientPhone: localPhone(address.recipientPhone),
    province: address.province,
    city: address.city,
    street: address.street,
    plaque: address.plaque ?? "",
    unit: address.unit ?? "",
    postalCode: address.postalCode,
    customerNote: "",
  };
}

export const PROVINCES = IRAN_PROVINCES;

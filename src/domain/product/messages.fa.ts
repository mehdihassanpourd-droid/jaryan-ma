import type { ProductIssueCode } from "./schema";

/** Persian messages for validation codes, shown by the admin UI. */
export const productIssueMessagesFa: Record<ProductIssueCode, string> = {
  variants_not_allowed_for_unique: "اثر یگانه نمی‌تواند تنوع (واریانت) داشته باشد.",
  unique_inventory_must_be_0_or_1: "موجودی اثر یگانه فقط می‌تواند ۰ یا ۱ باشد.",
  lead_time_only_for_made_to_order: "زمان آماده‌سازی فقط برای محصول سفارشی است.",
  inventory_required: "موجودی را وارد کنید.",
  inventory_on_variants: "وقتی تنوع دارید، موجودی را روی هر تنوع وارد کنید، نه روی محصول.",
  variant_inventory_required: "موجودی هر تنوع را وارد کنید.",
  lead_time_required: "زمان آماده‌سازی (به روز) برای محصول سفارشی لازم است.",
  inventory_not_allowed_for_made_to_order: "محصول سفارشی موجودی ندارد.",
  variant_inventory_not_allowed: "تنوع‌های محصول سفارشی موجودی ندارند.",
  duplicate_sku: "کد کالا (SKU) تکراری است.",
  variant_options_mismatch: "همه تنوع‌ها باید ویژگی‌های یکسانی داشته باشند (مثلاً همگی «سایز» و «رنگ»).",
  category_required_to_publish: "برای انتشار، دسته‌بندی را انتخاب کنید.",
  image_required_to_publish: "برای انتشار، دست‌کم یک تصویر لازم است.",
  price_required_to_publish: "برای انتشار، قیمت (تومان) را وارد کنید.",
  pipe_not_allowed: "نویسه «|» مجاز نیست.",
  equals_not_allowed: "نویسه «=» در نام ویژگی مجاز نیست.",
};

export function messageFa(code: string): string {
  return (productIssueMessagesFa as Record<string, string>)[code] ?? "مقدار واردشده معتبر نیست.";
}

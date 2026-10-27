import { ApiError } from "../api/client";
import { messageFa } from "@/domain/product/messages.fa";
import type { ValidationIssue } from "@/domain/product/schema";

const API_MESSAGES: Record<string, string> = {
  network_error: "ارتباط با سرور برقرار نشد. اینترنت خود را بررسی کنید و دوباره تلاش کنید.",
  unauthorized: "نشست شما پایان یافته است. دوباره وارد شوید.",
  forbidden: "شما اجازه انجام این کار را ندارید.",
  bad_origin: "این درخواست از آدرس مجاز ارسال نشد.",
  bad_csrf_token: "نشست شما نامعتبر شد. صفحه را دوباره بارگذاری کنید.",
  validation_failed: "اطلاعات واردشده معتبر نیست.",
  invalid_query: "جست‌وجو یا فیلتر نامعتبر است.",
  version_conflict: "این محصول هم‌زمان توسط شخص یا دستگاه دیگری تغییر کرده است. آخرین نسخه را بارگذاری کنید و تغییرات را دوباره اعمال کنید.",
  slug_taken: "این نشانی (اسلاگ) قبلاً استفاده شده است.",
  sku_taken: "یکی از کدهای کالا (SKU) قبلاً برای محصول دیگری ثبت شده است.",
  category_slug_taken: "این نشانی دسته‌بندی قبلاً استفاده شده است.",
  not_found: "مورد درخواستی پیدا نشد (ممکن است حذف شده باشد).",
  payload_too_large: "حجم فایل بیش از حد مجاز است.",
  invalid_image: "فایل تصویر معتبر نیست (فقط JPEG، PNG یا WebP).",
  too_many_images: "به حداکثر تعداد تصاویر این محصول رسیده‌اید.",
  chunk_too_large: "تعداد ردیف‌های ارسالی بیش از حد مجاز است.",
  internal_error: "خطای غیرمنتظره در سرور. چند لحظه بعد دوباره تلاش کنید.",
  invalid_credentials: "ایمیل یا گذرواژه درست نیست.",
  totp_required: "کد تأیید دومرحله‌ای را وارد کنید.",
  invalid_totp: "کد دومرحله‌ای درست نیست یا منقضی شده است. کد تازه را وارد کنید.",
  totp_not_enrolled: "دومرحله‌ای برای این حساب فعال نشده است. مدیر سرور باید آن را با دستور مدیریتی فعال کند؛ تا آن زمان ورود ممکن نیست.",
  too_many_attempts: "تعداد تلاش‌ها زیاد بود. کمی صبر کنید و دوباره تلاش کنید.",
  weak_password: "گذرواژه جدید به‌اندازه کافی قوی نیست.",
  unsupported_media_type: "نوع فایل پشتیبانی نمی‌شود.",
  rate_limited: "درخواست‌ها زیاد است. کمی صبر کنید.",
};

/** One readable line from the development-only explanation of a refused origin (empty when the server sent none). */
export function originDetailText(detail: unknown): string {
  if (typeof detail !== "object" || detail === null) return "";
  const d = detail as { receivedOrigin?: unknown; requestedHost?: unknown; allowedOrigins?: unknown; referer?: unknown; build?: unknown };
  const hosts = Array.isArray(d.requestedHost) ? [...new Set(d.requestedHost.map(String))].join(" , ") : "";
  const extra = [d.referer ? `Referer: ${String(d.referer)}` : "", d.build ? `نسخه: ${String(d.build)}` : ""].filter(Boolean).join(" | ");
  return `Origin دریافتی: ${String(d.receivedOrigin ?? "؟")} | Host درخواست: ${hosts || "؟"} | مجاز: ${String(d.allowedOrigins ?? "؟")}${extra ? ` | ${extra}` : ""}`;
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "bad_origin") {
      const detail = originDetailText(error.detail);
      return detail ? `${API_MESSAGES.bad_origin} (${detail})` : API_MESSAGES.bad_origin!;
    }
    if (error.status === 429 || error.code === "too_many_attempts") {
      const wait = error.retryAfterSeconds ? ` (حدود ${Math.ceil(error.retryAfterSeconds / 60)} دقیقه)` : "";
      return `${API_MESSAGES.too_many_attempts}${wait}`;
    }
    return API_MESSAGES[error.code] ?? (error.status >= 500 ? API_MESSAGES.internal_error! : "درخواست انجام نشد.");
  }
  return "خطای ناشناخته. دوباره تلاش کنید.";
}

/** Persian text for one validation issue, aware of which field it belongs to. */
export function issueMessage(issue: ValidationIssue): string {
  const field = issue.path.split(".")[0] ?? "";
  switch (issue.code) {
    case "invalid_too_small":
      return field === "name" ? "نام محصول باید دست‌کم ۲ نویسه باشد." : "مقدار واردشده کوتاه‌تر از حد مجاز است.";
    case "invalid_too_big":
      if (field === "seoTitle") return "عنوان سئو حداکثر ۷۰ نویسه می‌تواند باشد.";
      if (field === "seoDescription") return "توضیح سئو حداکثر ۱۶۰ نویسه می‌تواند باشد.";
      if (field === "name") return "نام محصول حداکثر ۱۲۰ نویسه می‌تواند باشد.";
      if (field === "description") return "توضیحات حداکثر ۵۰۰۰ نویسه می‌تواند باشد.";
      return "مقدار واردشده بلندتر از حد مجاز است.";
    case "invalid_invalid_format":
      if (field === "slug") return "نشانی (اسلاگ) فقط می‌تواند شامل حرف، عدد و خط تیره باشد.";
      if (issue.path.endsWith("sku")) return "کد کالا فقط می‌تواند شامل حروف انگلیسی، عدد و . _ - باشد.";
      return "قالب مقدار درست نیست.";
    case "invalid_type":
      return "مقدار واردشده درست نیست.";
    case "invalid_unknown_category":
    case "unknown_category":
      return "دسته‌بندی انتخاب‌شده وجود ندارد.";
    default:
      return messageFa(issue.code);
  }
}

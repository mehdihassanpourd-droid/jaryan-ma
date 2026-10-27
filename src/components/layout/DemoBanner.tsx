import { LIVE_CATALOG_BASE } from "@/lib/live-config";

/** Site-wide notice while most content is sample data. Remove when real data replaces it. */
export function DemoBanner() {
  // Products come from the real catalogue: only what is still true is said (no online buying or payment yet).
  if (LIVE_CATALOG_BASE) {
    return <div className="bg-olive-700 px-5 py-2 text-center text-xs leading-6 text-ivory-50 sm:text-sm">فروشگاه در حال راه‌اندازی است: خرید و پرداخت اینترنتی هنوز فعال نیست.</div>;
  }
  return (
    <div className="bg-olive-700 px-5 py-2 text-center text-xs leading-6 text-ivory-50 sm:text-sm">
      نسخه نمایشی: هر بخشی با برچسب «نمونه» محتوای آزمایشی است. فقط نام گالری، شعار و حساب اینستاگرام واقعی‌اند؛ فروش یا پرداخت فعال نیست.
    </div>
  );
}

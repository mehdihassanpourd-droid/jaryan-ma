import { LIVE_CATALOG_BASE } from "@/lib/live-config";

/** Site-wide notice while most content is sample data. Remove when real data replaces it. */
export function DemoBanner() {
  // Products come from the real catalogue: only what is still true is said (no online buying or payment yet).
  if (LIVE_CATALOG_BASE) {
    return <div className="bg-teal-900 px-5 py-1.5 text-center text-[11px] leading-5 text-ivory-50 sm:text-sm">فروشگاه در حال راه‌اندازی است: خرید و پرداخت اینترنتی هنوز فعال نیست.</div>;
  }
  return (
    <div className="bg-teal-900 px-5 py-1.5 text-center text-[11px] leading-5 text-ivory-50 sm:text-sm">
      نسخه نمایشی؛ بخش‌های دارای برچسب «نمونه» واقعی نیستند. فروش فعال نیست.
    </div>
  );
}

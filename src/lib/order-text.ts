import { formatNumber, formatToman } from "@/lib/format";
import type { ShippingInput } from "@/domain/customer/schema";
import type { PricedLine } from "./cart-pricing";
import { localPhone } from "./checkout-form";

/**
 * A plain-text order request the shopper can send to the gallery by Instagram message. This is the ONLY real way to
 * order while the store has no connected order system; it is text on the screen, never stored or sent by the site.
 */
export function buildOrderText(lines: readonly PricedLine[], total: bigint, shipping: ShippingInput, note: string | null): string {
  const rows = lines.flatMap((p, i) =>
    p.ok ? [`${formatNumber(i + 1)}) ${p.product.name}${p.variantLabel ? ` — ${p.variantLabel}` : ""} — ${formatNumber(p.quantity)} عدد × ${formatToman(p.unitPriceToman)}`] : [],
  );
  const address = [shipping.province, shipping.city, shipping.street, shipping.plaque ? `پلاک ${shipping.plaque}` : null, shipping.unit ? `واحد ${shipping.unit}` : null, `کد پستی ${shipping.postalCode}`].filter(Boolean).join("، ");
  return [
    "درخواست سفارش از فروشگاه جریان ما",
    ...rows,
    `جمع کالاها: ${formatToman(total)} (هزینهٔ ارسال لحاظ نشده)`,
    `گیرنده: ${shipping.recipientName}`,
    `موبایل: ${localPhone(shipping.recipientPhone)}`,
    `نشانی: ${address}`,
    ...(note ? [`توضیحات: ${note}`] : []),
  ].join("\n");
}

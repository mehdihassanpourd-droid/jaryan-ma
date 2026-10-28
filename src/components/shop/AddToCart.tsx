"use client";

import Link from "next/link";
import { useState } from "react";
import type { PublicProduct } from "@/domain/product/snapshot";
import { quantityLimit } from "@/lib/cart-pricing";
import { formatToman } from "@/lib/format";
import { QuantityStepper } from "./QuantityStepper";
import { useCart } from "./useCart";

/** Quantity + "add to cart" for the variant chosen in the options list above. Disabled with a reason when it cannot be bought. */
export function AddToCart({ product, sku }: { product: PublicProduct; sku: string | null }) {
  const cart = useCart();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState<number | null>(null);
  const variant = sku === null ? null : product.variants.find((v) => v.sku === sku) ?? null;
  const hasVariants = product.variants.length > 0;
  const price = variant ? variant.priceToman : product.priceToman;
  const available = hasVariants ? variant?.available === true : product.availability !== "sold_out";
  const priced = price !== null && price > 0;
  const max = quantityLimit(product);
  // How many of this exact item are already in the cart: a unique piece (limit 1) must never be added twice.
  const inCart = cart.lines.find((l) => l.slug === product.slug && l.sku === (variant ? variant.sku : null))?.quantity ?? 0;
  const room = Math.max(0, max - inCart);

  let blocked: string | null = null;
  if (hasVariants && !variant) blocked = "یک گزینه را انتخاب کنید.";
  else if (!available) blocked = "این مورد در حال حاضر ناموجود است.";
  else if (!priced) blocked = "قیمت این محصول هنوز اعلام نشده است.";
  else if (room === 0) blocked = max === 1 ? "این اثر در سبد خرید شما هست." : "حداکثر تعداد مجاز این کالا در سبد شما هست.";

  return (
    <section aria-label="افزودن به سبد خرید" className="mt-8 rounded-[1.75rem] border border-sand-200 bg-ivory-100 p-4 sm:p-5">
      {hasVariants && variant && priced && <p className="mb-3 text-sm text-bark-700">قیمت گزینهٔ انتخاب‌شده: <strong>{formatToman(price)}</strong></p>}
      <div className="flex flex-wrap items-center gap-4">
        {max > 1 ? (
          <QuantityStepper value={Math.min(quantity, Math.max(1, room))} max={Math.max(1, room)} label={product.name} onChange={setQuantity} />
        ) : (
          <span className="text-sm text-bark-600">اثر یگانه: فقط یک عدد</span>
        )}
        <button
          type="button"
          disabled={blocked !== null}
          onClick={() => {
            const amount = Math.min(quantity, room);
            cart.add({ slug: product.slug, sku: variant ? variant.sku : null, quantity: amount });
            setAdded(amount);
          }}
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-bark-900 px-7 py-2.5 text-base font-medium text-ivory-50 transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-sand-300 disabled:text-bark-700"
        >
          افزودن به سبد خرید
        </button>
      </div>
      {blocked && <p className="mt-3 text-sm text-bark-600" role="note">{blocked}</p>}
      {added !== null && (
        <p role="status" className="mt-3 text-sm text-teal-700">
          به سبد اضافه شد. <Link href="/cart" className="font-semibold underline">مشاهدهٔ سبد خرید</Link>
        </p>
      )}
    </section>
  );
}

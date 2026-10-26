import { formatToman } from "@/lib/format";
import { parsePrice } from "../../lib/money";
import { FULFILLMENT_LABELS, STATUS_LABELS } from "../../lib/product-form";
import { isSafeImageKey, mediaUrl } from "../../lib/images";
import { useUser } from "../../session";
import { Alert, Badge } from "../../ui/feedback";
import type { TabProps } from "./types";

/** An approximation drawn by the admin itself: the real storefront only ever shows published products. */
export function PreviewTab({ form, categories }: TabProps) {
  const user = useUser();
  const price = parsePrice(form.price);
  const cover = form.images[0];
  const category = categories.find((c) => c.id === form.categoryId)?.name;
  return (
    <div className="preview-wrap">
      <div className="phone" aria-label="پیش‌نمایش موبایل">
        <div className="phone-body">
          {cover && isSafeImageKey(cover.key) ? <img src={mediaUrl(user.mediaBaseUrl, cover.key)} alt={cover.alt || form.name} /> : <div className="noimg">بدون تصویر</div>}
          {category && <span className="muted">{category}</span>}
          <h2>{form.name || "نام محصول"}</h2>
          <p>{price.ok && price.value !== null ? formatToman(price.value) : "قیمت اعلام نشده"}</p>
          <p className="muted">{FULFILLMENT_LABELS[form.fulfillment]}</p>
          <p>{form.description || "توضیحاتی وارد نشده است."}</p>
        </div>
      </div>
      <div className="stack">
        <Badge tone={form.status === "published" ? "olive" : "neutral"}>{STATUS_LABELS[form.status]}</Badge>
        <Alert>
          این پیش‌نمایش تقریبی است و از همین فرم ساخته می‌شود. فروشگاه عمومی فقط محصولات «منتشرشده» را نشان می‌دهد؛ پیش‌نویس و بایگانی هرگز نمایش داده نمی‌شود.
        </Alert>
      </div>
    </div>
  );
}

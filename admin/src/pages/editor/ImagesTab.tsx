import { useRef, useState } from "react";
import { api } from "../../api/client";
import { apiErrorMessage } from "../../lib/errors";
import { ImageError, isSafeImageKey, mediaUrl, prepareImage } from "../../lib/images";
import { MAX_IMAGES_PER_PRODUCT, moveItem } from "../../lib/product-form";
import { useUser } from "../../session";
import { Button, TextField } from "../../ui/controls";
import { Alert, Badge, useConfirm, useToast } from "../../ui/feedback";
import { Icon } from "../../ui/Icon";
import type { TabProps } from "./types";

const IMAGE_ERRORS: Record<ImageError["code"], string> = {
  not_an_image: "فایل انتخاب‌شده تصویر نیست.",
  decode_failed: "تصویر خوانده نشد. فایل دیگری را امتحان کنید.",
  too_large: "حجم تصویر حتی پس از کوچک‌سازی از حد مجاز بیشتر است.",
};

export function ImagesTab({ form, setForm, readOnly, productId }: TabProps & { productId: string | null }) {
  const user = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const full = form.images.length >= MAX_IMAGES_PER_PRODUCT;

  async function upload(files: FileList | null) {
    if (!files || files.length === 0 || !productId) return;
    const list = Array.from(files).slice(0, MAX_IMAGES_PER_PRODUCT - form.images.length);
    setProgress({ done: 0, total: list.length });
    let done = 0;
    for (const file of list) {
      try {
        const { blob, type } = await prepareImage(file);
        const added = await api<{ key: string; alt: string }>("POST", `/products/${productId}/images`, { raw: blob, contentType: type });
        setForm((f) => ({ ...f, images: [...f.images, { key: added.key, alt: added.alt }] }));
      } catch (e) {
        toast.error(e instanceof ImageError ? IMAGE_ERRORS[e.code] : apiErrorMessage(e));
      }
      setProgress({ done: ++done, total: list.length });
    }
    setProgress(null);
    toast.success("تصاویر بارگذاری شد. برای ثبت ترتیب و متن جایگزین، ذخیره کنید.");
    if (camera.current) camera.current.value = "";
    if (gallery.current) gallery.current.value = "";
  }

  async function remove(i: number) {
    if (await confirm({ title: "حذف تصویر", message: "تصویر از این محصول برداشته می‌شود (با ذخیره).", confirmLabel: "حذف", danger: true })) {
      setForm((f) => ({ ...f, images: f.images.filter((_, k) => k !== i) }));
    }
  }

  if (!productId) {
    return <Alert tone="info">برای بارگذاری تصویر، ابتدا محصول را به‌صورت پیش‌نویس ذخیره کنید؛ سپس دوباره به این تب بیایید.</Alert>;
  }

  return (
    <div className="stack">
      {!readOnly && (
        <div className="stack">
          <div className="upload-actions">
            <Button variant="primary" disabled={full || progress !== null} onClick={() => camera.current?.click()}><Icon name="camera" /> گرفتن عکس</Button>
            <Button disabled={full || progress !== null} onClick={() => gallery.current?.click()}><Icon name="gallery" /> انتخاب از گالری</Button>
          </div>
          <input ref={camera} className="visually-hidden-input" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-label="گرفتن عکس با دوربین" onChange={(e) => void upload(e.target.files)} />
          <input ref={gallery} className="visually-hidden-input" type="file" accept="image/jpeg,image/png,image/webp" multiple tabIndex={-1} aria-label="انتخاب تصویر از گالری" onChange={(e) => void upload(e.target.files)} />
          <p className="hint">حداکثر {MAX_IMAGES_PER_PRODUCT.toLocaleString("fa-IR")} تصویر. تصاویر بزرگ پیش از ارسال کوچک می‌شوند. تصویر اول، تصویر اصلی محصول است.</p>
          {progress && (
            <div role="status" aria-live="polite">
              <progress max={progress.total} value={progress.done} aria-label="پیشرفت بارگذاری" />
              <p className="hint">{progress.done.toLocaleString("fa-IR")} از {progress.total.toLocaleString("fa-IR")}</p>
            </div>
          )}
        </div>
      )}
      {form.images.length === 0 ? (
        <p className="muted">هنوز تصویری اضافه نشده است.</p>
      ) : (
        <ol className="image-grid">
          {form.images.map((img, i) => (
            <li key={img.key} className="image-item">
              {isSafeImageKey(img.key) ? <img src={mediaUrl(user.mediaBaseUrl, img.key)} alt={img.alt || "تصویر محصول"} /> : <span className="thumb">؟</span>}
              <div className="stack">
                {i === 0 && <Badge tone="olive">تصویر اصلی</Badge>}
                <TextField label="متن جایگزین (توصیف تصویر)" hint="برای نابینایان و موتورهای جست‌وجو؛ بنویسید تصویر چه چیزی را نشان می‌دهد." value={img.alt} readOnly={readOnly} counter={{ value: img.alt.length, max: 200 }} onChange={(e) => setForm((f) => ({ ...f, images: f.images.map((x, k) => (k === i ? { ...x, alt: e.target.value } : x)) }))} />
              </div>
              {!readOnly && (
                <div className="tools">
                  <Button small disabled={i === 0} aria-label={`انتقال تصویر ${i + 1} به قبل`} onClick={() => setForm((f) => ({ ...f, images: moveItem(f.images, i, i - 1) }))}><Icon name="up" /> بالا</Button>
                  <Button small disabled={i === form.images.length - 1} aria-label={`انتقال تصویر ${i + 1} به بعد`} onClick={() => setForm((f) => ({ ...f, images: moveItem(f.images, i, i + 1) }))}><Icon name="down" /> پایین</Button>
                  <Button small variant="danger" aria-label={`حذف تصویر ${i + 1}`} onClick={() => void remove(i)}><Icon name="trash" /> حذف</Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { ProductStatus, StoredProduct } from "@/domain/product/types";
import { ApiError, api } from "../api/client";
import { apiErrorMessage } from "../lib/errors";
import { emptyForm, firstError, fromStored, issuesToErrors, serializeForm, STATUS_LABELS, validateForm, type FieldErrors, type ProductForm } from "../lib/product-form";
import { useCategories } from "../lib/useCategories";
import { hrefFor, navigate } from "../router";
import { useSession } from "../session";
import { Button } from "../ui/controls";
import { Alert, Badge, Loading, useConfirm, useToast } from "../ui/feedback";
import { BasicsTab } from "./editor/BasicsTab";
import { ImagesTab } from "./editor/ImagesTab";
import { PreviewTab } from "./editor/PreviewTab";
import { SeoTab } from "./editor/SeoTab";
import { VariantsTab } from "./editor/VariantsTab";

const TABS = [
  { id: "basics", label: "اطلاعات", fields: ["name", "description", "categoryId", "fulfillment", "priceToman", "inventory", "leadTimeDays", "slug"] },
  { id: "variants", label: "گونه‌ها", fields: ["variants"] },
  { id: "images", label: "تصاویر", fields: ["images"] },
  { id: "seo", label: "سئو", fields: ["seoTitle", "seoDescription"] },
  { id: "preview", label: "پیش‌نمایش", fields: [] },
] as const;
type TabId = (typeof TABS)[number]["id"];

const tabOfError = (path: string): TabId => TABS.find((t) => t.fields.some((f) => path === f || path.startsWith(`${f}.`)))?.id ?? "basics";

export function ProductEditorPage({ id }: { id: string | null }) {
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const { categories } = useCategories();
  const [product, setProduct] = useState<StoredProduct | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [saved, setSaved] = useState(() => serializeForm(emptyForm()));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(id !== null);
  const [saving, setSaving] = useState<ProductStatus | null>(null);
  const [conflict, setConflict] = useState(false);
  const [tab, setTab] = useState<TabId>("basics");

  const readOnly = !can("product:write");
  // Messages from the last save describe the form as it WAS: once the person changes anything (e.g. uploads the missing photo)
  // they are stale, and leaving the red banner and tab dots up until the next save made a fixed form look broken.
  const editForm = useCallback<Dispatch<SetStateAction<ProductForm>>>((update) => {
    setForm(update);
    setErrors((current) => (Object.keys(current).length === 0 ? current : {}));
  }, []);
  const dirty = useMemo(() => serializeForm(form) !== saved, [form, saved]);

  const adopt = useCallback((p: StoredProduct) => {
    const next = fromStored(p);
    setProduct(p);
    setForm(next);
    setSaved(serializeForm(next));
    setErrors({});
    setConflict(false);
  }, []);

  const fetchProduct = useCallback(() => {
    if (!id) return;
    api<{ product: StoredProduct }>("GET", `/products/${id}`).then(
      (r) => { adopt(r.product); setLoadError(null); setLoading(false); },
      (e: unknown) => { setLoadError(apiErrorMessage(e)); setLoading(false); },
    );
  }, [id, adopt]);
  useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);
  const load = useCallback(() => {
    setLoading(true);
    fetchProduct();
  }, [fetchProduct]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  async function save(status: ProductStatus) {
    const checked = validateForm(form, status);
    if (!checked.ok) {
      setErrors(checked.errors);
      const first = firstError(checked.errors);
      if (first) setTab(tabOfError(first[0]));
      toast.error(first ? first[1] : "اطلاعات فرم کامل نیست.");
      return;
    }
    setErrors({});
    setSaving(status);
    try {
      if (!product) {
        const r = await api<{ product: StoredProduct }>("POST", "/products", { body: checked.body });
        toast.success("محصول ذخیره شد. حالا می‌توانید تصویر اضافه کنید.");
        adopt(r.product);
        // Show the product's own address WITHOUT re-rendering the route: `navigate` would remount this editor (its key is the
        // route id), resetting the tab and dropping whatever the person did right after saving. Saving continues to use
        // `product.id` from state, and a reload of this address loads the product normally.
        window.history.replaceState(null, "", hrefFor(`/products/${r.product.id}`));
        // Guide a new draft towards adding photos, but never override a tab the person has already moved to while saving.
        setTab((current) => (current === "basics" && status === "draft" ? "images" : current));
      } else {
        const r = await api<{ product: StoredProduct }>("PUT", `/products/${product.id}`, { body: { expectedVersion: product.version, product: checked.body } });
        adopt(r.product);
        toast.success(status === "published" ? "تغییرات ذخیره و محصول منتشر شد." : "تغییرات ذخیره شد.");
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "version_conflict") setConflict(true);
      else if (e instanceof ApiError && e.code === "validation_failed" && e.issues.length > 0) {
        const mapped = issuesToErrors(e.issues);
        setErrors(mapped);
        const first = firstError(mapped);
        if (first) setTab(tabOfError(first[0]));
        toast.error(first ? first[1] : apiErrorMessage(e));
      } else if (e instanceof ApiError && e.code === "sku_taken") {
        setTab("variants");
        toast.error(apiErrorMessage(e));
      } else if (e instanceof ApiError && e.code === "slug_taken") {
        setErrors({ slug: apiErrorMessage(e) });
        setTab("basics");
        toast.error(apiErrorMessage(e));
      } else toast.error(apiErrorMessage(e));
    } finally {
      setSaving(null);
    }
  }

  async function archive() {
    if (!product) return;
    if (!(await confirm({ title: "بایگانی محصول", message: "محصول از فروشگاه برداشته می‌شود. هر زمان می‌توانید آن را بازگردانید.", confirmLabel: "بایگانی", danger: true }))) return;
    await save("archived");
  }

  async function leave() {
    if (dirty && !(await confirm({ title: "تغییرات ذخیره‌نشده", message: "اگر خارج شوید، تغییرات از بین می‌رود.", confirmLabel: "خروج بدون ذخیره", danger: true }))) return;
    navigate("/products");
  }

  if (loading) return <Loading />;
  if (loadError) return <Alert tone="error" action={<Button onClick={load}>تلاش دوباره</Button>}>{loadError}</Alert>;

  const status = product?.status ?? "draft";
  const canPublish = can("product:publish");
  const errorTabs = new Set(Object.keys(errors).map(tabOfError));

  return (
    <div className="stack">
      <div className="page-head">
        <h1>{product ? form.name || "ویرایش محصول" : "محصول جدید"}</h1>
        <div className="row">
          <Badge tone={status === "published" ? "olive" : "neutral"}>{STATUS_LABELS[status]}</Badge>
          <Button small variant="ghost" onClick={() => void leave()}>بازگشت به فهرست</Button>
        </div>
      </div>

      {readOnly && <Alert>نقش شما فقط اجازهٔ مشاهده دارد؛ ویرایش غیرفعال است.</Alert>}
      {conflict && (
        <Alert tone="warn" title="تغییر هم‌زمان" action={<Button onClick={load}>بارگذاری آخرین نسخه</Button>}>
          {"این محصول هم‌زمان توسط شخص یا دستگاه دیگری تغییر کرده است. آخرین نسخه را بارگذاری کنید و تغییرات خود را دوباره اعمال کنید. (تغییرات فعلی شما پاک می‌شود.)"}
        </Alert>
      )}
      {Object.keys(errors).length > 0 && <Alert tone="error">برخی فیلدها نیاز به اصلاح دارند؛ در تب‌های علامت‌دار ببینید.</Alert>}

      <div className="tabs" role="tablist" aria-label="بخش‌های محصول">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} onClick={() => setTab(t.id)}>
            {t.label}
            {errorTabs.has(t.id) && <span className="dot" role="img" aria-label="دارای خطا" />}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="card">
        {tab === "basics" && <BasicsTab form={form} setForm={editForm} errors={errors} categories={categories ?? []} readOnly={readOnly} />}
        {tab === "variants" && <VariantsTab form={form} setForm={editForm} errors={errors} categories={categories ?? []} readOnly={readOnly} />}
        {tab === "images" && <ImagesTab form={form} setForm={editForm} errors={errors} categories={categories ?? []} readOnly={readOnly} productId={product?.id ?? null} />}
        {tab === "seo" && <SeoTab form={form} setForm={editForm} errors={errors} categories={categories ?? []} readOnly={readOnly} />}
        {tab === "preview" && <PreviewTab form={form} setForm={editForm} errors={errors} categories={categories ?? []} readOnly={readOnly} />}
      </div>

      {!readOnly && (
        <div className="sticky-bar">
          <span className="muted" aria-live="polite">{dirty ? "تغییرات ذخیره‌نشده" : "همه‌چیز ذخیره است"}</span>
          <span className="row">
            {product && canPublish && status !== "archived" && <Button variant="danger" disabled={saving !== null} onClick={() => void archive()}>بایگانی</Button>}
            {status !== "published" && (
              <Button variant={canPublish && status === "draft" ? "secondary" : "primary"} loading={saving === "draft" || saving === "archived"} disabled={saving !== null || (!dirty && product !== null)} onClick={() => void save(status === "archived" ? "archived" : "draft")}>
                ذخیره پیش‌نویس
              </Button>
            )}
            {canPublish && status !== "published" && (
              <Button variant="primary" loading={saving === "published"} disabled={saving !== null} onClick={() => void save("published")}>
                {product ? "ذخیره و انتشار" : "ایجاد و انتشار"}
              </Button>
            )}
            {status === "published" && (
              <>
                <Button variant="primary" loading={saving === "published"} disabled={saving !== null || !dirty} onClick={() => void save("published")}>ذخیره تغییرات</Button>
                {canPublish && <Button disabled={saving !== null} onClick={() => void save("draft")}>برگرداندن به پیش‌نویس</Button>}
              </>
            )}
          </span>
        </div>
      )}
      {product && <p className="hint"><a href={hrefFor("/products")}>فهرست محصولات</a></p>}
    </div>
  );
}

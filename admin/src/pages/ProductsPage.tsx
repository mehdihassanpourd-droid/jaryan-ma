import { useCallback, useEffect, useState } from "react";
import { formatToman } from "@/lib/format";
import { FULFILLMENTS, PRODUCT_STATUSES, type ProductListRow, type ProductStatus, type StoredProduct } from "@/domain/product/types";
import type { ProductPage } from "@/domain/product/ports";
import { api } from "../api/client";
import { apiErrorMessage } from "../lib/errors";
import { duplicateBody, FULFILLMENT_LABELS, STATUS_LABELS } from "../lib/product-form";
import { isSafeImageKey, mediaUrl } from "../lib/images";
import { useCategories } from "../lib/useCategories";
import { hrefFor, navigate, useRoute } from "../router";
import { useSession, useUser } from "../session";
import { ApiError } from "../api/client";
import { Button, SelectField, TextField } from "../ui/controls";
import { Alert, Badge, EmptyState, Loading, Pagination, useConfirm, useToast } from "../ui/feedback";
import { Icon } from "../ui/Icon";

const PAGE_SIZE = 20;
const SORTS = [
  { value: "updated_desc", label: "تازه‌ترین تغییر" },
  { value: "created_desc", label: "تازه‌ترین ساخته‌شده" },
  { value: "name_asc", label: "نام (الفبایی)" },
  { value: "price_asc", label: "ارزان‌ترین" },
  { value: "price_desc", label: "گران‌ترین" },
];
const TONE: Record<ProductStatus, "neutral" | "olive" | "muted"> = { draft: "neutral", published: "olive", archived: "muted" };

export function ProductsPage() {
  const route = useRoute();
  const user = useUser();
  const { can } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const { categories } = useCategories();
  const p = route.params;
  const q = p.get("q") ?? "";
  const status = p.get("status") ?? "";
  const categoryId = p.get("categoryId") ?? "";
  const fulfillment = p.get("fulfillment") ?? "";
  const availability = p.get("availability") ?? "";
  const sort = p.get("sort") ?? "updated_desc";
  const page = Math.max(1, Number(p.get("page")) || 1);

  const [search, setSearch] = useState(q);
  const [data, setData] = useState<ProductPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const setParam = useCallback(
    (patch: Record<string, string>) => {
      const next = { q, status, categoryId, fulfillment, availability, sort, page: "1", ...patch };
      navigate("/products", next, { replace: true });
    },
    [q, status, categoryId, fulfillment, availability, sort],
  );

  // Debounced search: the URL is the single source of truth for the list state.
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => setParam({ q: search }), 350);
    return () => clearTimeout(t);
  }, [search, q, setParam]);

  useEffect(() => {
    const ctrl = new AbortController();
    api<ProductPage>("GET", "/products", {
      query: { q, status, categoryId, fulfillment, availability, sort: sort === "updated_desc" ? undefined : sort, page, pageSize: PAGE_SIZE },
      signal: ctrl.signal,
    }).then((r) => {
      setData(r);
      setError(null);
    }, (e: unknown) => {
      if (!(e instanceof DOMException)) setError(apiErrorMessage(e));
    });
    return () => ctrl.abort();
  }, [q, status, categoryId, fulfillment, availability, sort, page, tick]);

  const categoryName = (id: string | null) => categories?.find((c) => c.id === id)?.name ?? "بدون دسته";

  async function changeStatus(row: ProductListRow, next: ProductStatus) {
    if (next === "archived" && !(await confirm({ title: "بایگانی محصول", message: `«${row.name}» از فروشگاه برداشته می‌شود. هر زمان می‌توانید آن را به پیش‌نویس برگردانید.`, confirmLabel: "بایگانی", danger: true }))) return;
    setBusyId(row.id);
    try {
      await api("POST", `/products/${row.id}/status`, { body: { status: next, expectedVersion: row.version } });
      toast.success(next === "archived" ? "محصول بایگانی شد." : next === "published" ? "محصول منتشر شد." : "محصول به پیش‌نویس برگشت.");
      setTick((t) => t + 1);
    } catch (e) {
      toast.error(e instanceof ApiError && e.code === "validation_failed" ? "برای انتشار، دسته‌بندی، حداقل یک تصویر و قیمت لازم است. محصول را ویرایش کنید." : apiErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function duplicate(row: ProductListRow) {
    setBusyId(row.id);
    try {
      const { product } = await api<{ product: StoredProduct }>("GET", `/products/${row.id}`);
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          const created = await api<{ product: StoredProduct }>("POST", "/products", { body: duplicateBody(product, attempt) });
          toast.success("نسخهٔ کپی به‌صورت پیش‌نویس ساخته شد.");
          navigate(`/products/${created.product.id}`);
          return;
        } catch (e) {
          if (!(e instanceof ApiError && e.code === "sku_taken") || attempt === 5) throw e;
        }
      }
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  const cover = (row: ProductListRow) =>
    row.coverKey && isSafeImageKey(row.coverKey) ? <img className="thumb" src={mediaUrl(user.mediaBaseUrl, row.coverKey)} alt={row.coverAlt ?? ""} loading="lazy" width="72" height="90" /> : <span className="thumb">بدون تصویر</span>;

  const filtered = Boolean(q || status || categoryId || fulfillment || availability);

  return (
    <div className="stack">
      <div className="page-head">
        <h1>محصولات</h1>
        {can("product:write") && (
          <a className="btn btn-primary" href={hrefFor("/products/new")}>
            <Icon name="plus" /> محصول جدید
          </a>
        )}
      </div>

      <form className="filters card" role="search" aria-label="جست‌وجو و فیلتر محصولات" onSubmit={(e) => e.preventDefault()}>
        <TextField label="جست‌وجو" type="search" placeholder="نام یا توضیح محصول" value={search} onChange={(e) => setSearch(e.target.value)} />
        <details open={filtered || undefined}>
          <summary>فیلتر و مرتب‌سازی</summary>
          <div className="filters-grid">
        <SelectField label="وضعیت" value={status} onChange={(e) => setParam({ status: e.target.value })} options={[{ value: "", label: "همه (بدون بایگانی)" }, ...PRODUCT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))]} />
        <SelectField label="دسته‌بندی" value={categoryId} onChange={(e) => setParam({ categoryId: e.target.value })} options={[{ value: "", label: "همه" }, ...(categories ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
        <SelectField label="نوع تحویل" value={fulfillment} onChange={(e) => setParam({ fulfillment: e.target.value })} options={[{ value: "", label: "همه" }, ...FULFILLMENTS.map((f) => ({ value: f, label: FULFILLMENT_LABELS[f] }))]} />
        <SelectField label="موجودی" value={availability} onChange={(e) => setParam({ availability: e.target.value })} options={[{ value: "", label: "همه" }, { value: "in_stock", label: "موجود" }, { value: "out_of_stock", label: "ناموجود" }]} />
        <SelectField label="مرتب‌سازی" value={sort} onChange={(e) => setParam({ sort: e.target.value })} options={SORTS} />
          </div>
        </details>
      </form>

      {error ? (
        <Alert tone="error" action={<Button onClick={() => setTick((t) => t + 1)}>تلاش دوباره</Button>}>
          {error}
        </Alert>
      ) : !data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <EmptyState title={filtered ? "محصولی با این فیلتر پیدا نشد" : "هنوز محصولی ثبت نشده است"} action={!filtered && can("product:write") ? <a className="btn btn-primary" href={hrefFor("/products/new")}>اولین محصول را بسازید</a> : undefined}>
          {filtered ? "جست‌وجو یا فیلترها را تغییر دهید." : "می‌توانید محصول را دستی بسازید یا از فایل CSV وارد کنید."}
        </EmptyState>
      ) : (
        <>
          <p className="muted" aria-live="polite">{data.total.toLocaleString("fa-IR")} محصول</p>
          <ul className="product-list">
            {data.items.map((row) => (
              <li key={row.id} className="product-row">
                {cover(row)}
                <div className="stack">
                  <h3><a href={hrefFor(`/products/${row.id}`)}>{row.name}</a></h3>
                  <div className="product-meta">
                    <Badge tone={TONE[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                    <span>{categoryName(row.categoryId)}</span>
                    <span>{FULFILLMENT_LABELS[row.fulfillment]}</span>
                  </div>
                  <div className="product-meta">
                    <span>{(row.priceToman ?? row.variantMinPriceToman) === null ? "قیمت ثبت نشده" : formatToman((row.priceToman ?? row.variantMinPriceToman) as number)}</span>
                    {row.variantCount > 0 ? <span>{row.variantCount.toLocaleString("fa-IR")} گونه</span> : row.inventory !== null ? <span>موجودی: {row.inventory.toLocaleString("fa-IR")}</span> : null}
                  </div>
                </div>
                <div className="product-actions">
                  <a className="btn btn-secondary btn-small" href={hrefFor(`/products/${row.id}`)}>{can("product:write") ? "ویرایش" : "مشاهده"}</a>
                  {can("product:write") && <Button small loading={busyId === row.id} onClick={() => void duplicate(row)}>کپی</Button>}
                  {can("product:publish") && row.status === "draft" && <Button small variant="primary" loading={busyId === row.id} onClick={() => void changeStatus(row, "published")}>انتشار</Button>}
                  {can("product:publish") && row.status === "published" && <Button small loading={busyId === row.id} onClick={() => void changeStatus(row, "draft")}>برگرداندن به پیش‌نویس</Button>}
                  {can("product:publish") && row.status !== "archived" && <Button small variant="danger" loading={busyId === row.id} onClick={() => void changeStatus(row, "archived")}>بایگانی</Button>}
                  {can("product:publish") && row.status === "archived" && <Button small loading={busyId === row.id} onClick={() => void changeStatus(row, "draft")}>بازگردانی</Button>}
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(n) => navigate("/products", { q, status, categoryId, fulfillment, availability, sort, page: String(n) })} />
        </>
      )}
    </div>
  );
}

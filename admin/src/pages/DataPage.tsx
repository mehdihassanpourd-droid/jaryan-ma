import { useRef, useState } from "react";
import { parseProductCsv, productsToCsvRows, toCsv, PRODUCT_CSV_COLUMNS, type CsvImportResult } from "@/domain/product/csv";
import type { ProductPage } from "@/domain/product/ports";
import type { StoredProduct } from "@/domain/product/types";
import { api } from "../api/client";
import { csvIssueMessage, downloadText, mapLimit } from "../lib/csv-io";
import { apiErrorMessage } from "../lib/errors";
import { useCategories } from "../lib/useCategories";
import { useSession } from "../session";
import { Button } from "../ui/controls";
import { Alert, Loading, useToast } from "../ui/feedback";

const CHUNK = 25;

export function DataPage() {
  const { can } = useSession();
  const toast = useToast();
  const { categories, error: catError } = useCategories();
  const fileInput = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const [parsed, setParsed] = useState<(CsvImportResult & { fileName: string }) | null>(null);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (catError) return <Alert tone="error">{apiErrorMessage(catError)}</Alert>;
  if (!categories) return <Loading />;

  async function exportAll() {
    setFailure(null);
    try {
      const rows: StoredProduct[] = [];
      const ids: string[] = [];
      for (let page = 1; ; page++) {
        const r = await api<ProductPage>("GET", "/products", { query: { status: "draft,published,archived", pageSize: 100, page } });
        ids.push(...r.items.map((i) => i.id));
        if (ids.length >= r.total || r.items.length === 0) break;
      }
      setExporting({ done: 0, total: ids.length });
      let done = 0;
      const full = await mapLimit(ids, 6, async (id) => {
        const r = await api<{ product: StoredProduct }>("GET", `/products/${id}`);
        setExporting({ done: ++done, total: ids.length });
        return r.product;
      });
      rows.push(...full);
      const slugById = new Map((categories ?? []).map((c) => [c.id, c.slug]));
      downloadText(`jaryan-products-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(productsToCsvRows(rows, slugById)));
      toast.success(`${rows.length.toLocaleString("fa-IR")} محصول خروجی گرفته شد.`);
    } catch (e) {
      setFailure(apiErrorMessage(e));
    } finally {
      setExporting(null);
    }
  }

  function template() {
    downloadText("jaryan-products-template.csv", toCsv([[...PRODUCT_CSV_COLUMNS]]));
  }

  async function pick(file: File | undefined) {
    setResult(null);
    setFailure(null);
    setParsed(null);
    if (!file) return;
    const text = await file.text();
    const slugToId = new Map((categories ?? []).map((c) => [c.slug, c.id]));
    setParsed({ ...parseProductCsv(text, { categoryIdBySlug: slugToId }), fileName: file.name });
  }

  async function runImport() {
    if (!parsed || parsed.issues.length > 0) return;
    setFailure(null);
    setResult(null);
    const products = parsed.products;
    setImporting({ done: 0, total: products.length });
    let created = 0;
    let updated = 0;
    try {
      for (let i = 0; i < products.length; i += CHUNK) {
        const chunk = products.slice(i, i + CHUNK);
        const r = await api<{ created: number; updated: number }>("POST", "/products/import", { body: { products: chunk }, query: { defer: 1 } });
        created += r.created;
        updated += r.updated;
        setImporting({ done: Math.min(i + CHUNK, products.length), total: products.length });
      }
      await api("POST", "/catalog/resync", { body: {} });
      setResult({ created, updated });
      setParsed(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (e) {
      setFailure(`${apiErrorMessage(e)} ${created + updated > 0 ? `(${(created + updated).toLocaleString("fa-IR")} محصول پیش از خطا ثبت شده است؛ ورود دوباره امن است چون با نشانی یکسان به‌روزرسانی می‌شود.)` : ""}`);
    } finally {
      setImporting(null);
    }
  }

  return (
    <div className="stack">
      <div className="page-head"><h1>ورود و خروج داده</h1></div>

      <section className="card stack" aria-labelledby="export-h">
        <h2 id="export-h">خروجی CSV</h2>
        <p className="muted">همهٔ محصولات (پیش‌نویس، منتشرشده و بایگانی) با گونه‌ها و متن سئو. فایل با UTF-8 ساخته می‌شود و در اکسل و برنامه‌های گوشی فارسی را درست نشان می‌دهد.</p>
        <div className="row">
          <Button variant="primary" loading={exporting !== null} onClick={() => void exportAll()}>دریافت خروجی</Button>
          <Button onClick={template}>دریافت فایل نمونهٔ خالی</Button>
        </div>
        {exporting && (
          <div role="status" aria-live="polite">
            <progress max={Math.max(exporting.total, 1)} value={exporting.done} aria-label="پیشرفت خروجی" />
          </div>
        )}
      </section>

      {can("product:import") ? (
        <section className="card stack" aria-labelledby="import-h">
          <h2 id="import-h">ورود از CSV</h2>
          <p className="muted">ردیف‌هایی که نشانی (slug) یکسان دارند یک محصول‌اند و محصولِ موجود با همان نشانی به‌روز می‌شود. ابتدا فایل بررسی می‌شود و تا زمانی که خطایی هست، چیزی ثبت نمی‌شود.</p>
          <div className="field">
            <label htmlFor="csv-file">فایل CSV</label>
            <input id="csv-file" ref={fileInput} type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0])} />
          </div>

          {parsed && parsed.issues.length > 0 && (
            <div className="stack">
              <Alert tone="error" title={`${parsed.issues.length.toLocaleString("fa-IR")} مشکل در فایل پیدا شد`}>پس از اصلاح فایل، دوباره آن را انتخاب کنید.</Alert>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="فهرست مشکلات فایل">
                <table>
                  <caption className="visually-hidden-input">مشکلات فایل</caption>
                  <thead><tr><th scope="col">ردیف</th><th scope="col">ستون</th><th scope="col">مشکل</th></tr></thead>
                  <tbody>
                    {parsed.issues.slice(0, 200).map((issue, i) => (
                      <tr key={i}><td>{issue.row.toLocaleString("fa-IR")}</td><td dir="ltr">{issue.field}</td><td>{csvIssueMessage(issue)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.issues.length > 200 && <p className="hint">فقط ۲۰۰ مورد اول نمایش داده شد.</p>}
            </div>
          )}
          {parsed && parsed.issues.length === 0 && (
            <div className="stack">
              <Alert tone="success">{`فایل «${parsed.fileName}» درست است: ${parsed.products.length.toLocaleString("fa-IR")} محصول آمادهٔ ثبت.`}</Alert>
              <Button variant="primary" loading={importing !== null} disabled={parsed.products.length === 0} onClick={() => void runImport()}>ثبت {parsed.products.length.toLocaleString("fa-IR")} محصول</Button>
            </div>
          )}
          {importing && (
            <div role="status" aria-live="polite">
              <progress max={Math.max(importing.total, 1)} value={importing.done} aria-label="پیشرفت ورود" />
              <p className="hint">{importing.done.toLocaleString("fa-IR")} از {importing.total.toLocaleString("fa-IR")}</p>
            </div>
          )}
          {result && <Alert tone="success">{`ورود انجام شد: ${result.created.toLocaleString("fa-IR")} محصول جدید و ${result.updated.toLocaleString("fa-IR")} به‌روزرسانی.`}</Alert>}
        </section>
      ) : (
        <Alert>نقش شما اجازهٔ ورود داده ندارد؛ فقط خروجی گرفتن ممکن است.</Alert>
      )}
      {failure && <Alert tone="error">{failure}</Alert>}
    </div>
  );
}

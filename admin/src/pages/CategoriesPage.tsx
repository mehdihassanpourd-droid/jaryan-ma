import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import { apiErrorMessage } from "../lib/errors";
import { useCategories } from "../lib/useCategories";
import { useSession } from "../session";
import { Button, SelectField, TextField } from "../ui/controls";
import { Alert, EmptyState, Loading, useToast } from "../ui/feedback";

export function CategoriesPage() {
  const { can } = useSession();
  const toast = useToast();
  const { categories, error, reload } = useCategories();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFieldError(null);
    try {
      await api("POST", "/categories", { body: { name, slug, parentId: parentId || undefined } });
      toast.success("دسته‌بندی ساخته شد.");
      setName("");
      setSlug("");
      setParentId("");
      reload();
    } catch (e) {
      setFieldError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert tone="error" action={<Button onClick={reload}>تلاش دوباره</Button>}>{apiErrorMessage(error)}</Alert>;
  if (!categories) return <Loading />;
  const nameOf = (id: string | null) => categories.find((c) => c.id === id)?.name;

  return (
    <div className="stack">
      <div className="page-head"><h1>دسته‌بندی‌ها</h1></div>
      {categories.length === 0 ? (
        <EmptyState title="هنوز دسته‌بندی ندارید">برای انتشار هر محصول یک دسته‌بندی لازم است.</EmptyState>
      ) : (
        <ul className="product-list">
          {categories.map((c) => (
            <li key={c.id} className="product-row">
              <div className="stack">
                <h3>{c.name}</h3>
                <div className="product-meta"><span dir="ltr">{c.slug}</span>{c.parentId && <span>زیرمجموعهٔ {nameOf(c.parentId)}</span>}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {can("category:write") && (
        <form className="card stack" onSubmit={create} noValidate aria-labelledby="new-cat">
          <h2 id="new-cat">دسته‌بندی جدید</h2>
          {fieldError && <Alert tone="error">{fieldError}</Alert>}
          <TextField label="نام" required value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="نشانی (انگلیسی)" required hint="فقط حروف کوچک انگلیسی، عدد و خط تیره؛ مثلاً wall-hanging" dir="ltr" className="ltr-input" value={slug} onChange={(e) => setSlug(e.target.value)} />
          <SelectField label="زیرمجموعهٔ" value={parentId} onChange={(e) => setParentId(e.target.value)} options={[{ value: "", label: "بدون والد" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || !slug.trim()}>ساخت دسته‌بندی</Button>
        </form>
      )}
    </div>
  );
}

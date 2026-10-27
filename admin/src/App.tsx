import { useEffect, useRef } from "react";
import { hrefFor, isProductId, useRoute } from "./router";
import { useOrderSummary } from "./lib/useOrderSummary";
import { useSession, useUser } from "./session";
import { Button } from "./ui/controls";
import { Alert, Loading, useToast } from "./ui/feedback";
import { Icon } from "./ui/Icon";
import { AccountPage } from "./pages/AccountPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { DataPage } from "./pages/DataPage";
import { LoginPage } from "./pages/LoginPage";
import { OrdersPage } from "./pages/OrdersPage";
import { ProductEditorPage } from "./pages/ProductEditorPage";
import { ProductsPage } from "./pages/ProductsPage";

const NAV = [
  { path: "/products", label: "محصولات", icon: "products" },
  { path: "/orders", label: "سفارش‌ها", icon: "orders", permission: "order:read" },
  { path: "/data", label: "ورود و خروج", icon: "data" },
  { path: "/categories", label: "دسته‌ها", icon: "categories" },
  { path: "/account", label: "حساب", icon: "account" },
] as const;

function titleFor(path: string): string {
  if (path.startsWith("/products/new")) return "محصول جدید";
  if (path.startsWith("/products/")) return "ویرایش محصول";
  return NAV.find((n) => path.startsWith(n.path))?.label ?? "پیشخوان";
}

function Shell() {
  const route = useRoute();
  const user = useUser();
  const { can } = useSession();
  const toast = useToast();
  const mainRef = useRef<HTMLElement>(null);
  const title = titleFor(route.path);

  // "New orders" indicator: how many orders wait for a decision (polled from this same server; see useOrderSummary).
  const orders = useOrderSummary(can("order:read"));
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!orders.known) return;
    if (seen.current !== null && orders.pending > seen.current) toast.success("سفارش جدیدی ثبت شد و منتظر تأیید است.");
    seen.current = orders.pending;
  }, [orders.pending, orders.known, toast]);

  useEffect(() => {
    document.title = `${orders.pending > 0 ? `(${orders.pending.toLocaleString("fa-IR")}) ` : ""}${title} | مدیریت جریان ما`;
    mainRef.current?.focus();
    window.scrollTo(0, 0);
  }, [title, route.path, orders.pending]);

  let page = <ProductsPage />;
  const segments = route.path.split("/").filter(Boolean);
  if (segments[0] === "products" && segments[1]) {
    const id = segments[1];
    page =
      id === "new" || isProductId(id) ? (
        <ProductEditorPage key={id} id={id === "new" ? null : id} />
      ) : (
        <Alert tone="error">نشانی محصول معتبر نیست. <a href={hrefFor("/products")}>بازگشت به فهرست</a></Alert>
      );
  }
  else if (segments[0] === "orders") {
    const raw = segments[1];
    page = !can("order:read") ? (
      <Alert tone="error">این بخش برای نقش شما فعال نیست.</Alert>
    ) : raw === undefined ? (
      <OrdersPage number={null} onChanged={orders.refresh} />
    ) : /^\d{1,10}$/.test(raw) ? (
      <OrdersPage number={Number(raw)} onChanged={orders.refresh} />
    ) : (
      <Alert tone="error">شمارهٔ سفارش معتبر نیست. <a href={hrefFor("/orders")}>بازگشت به فهرست</a></Alert>
    );
  } else if (segments[0] === "data") page = <DataPage />;
  else if (segments[0] === "categories") page = <CategoriesPage />;
  else if (segments[0] === "account") page = <AccountPage />;

  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); mainRef.current?.focus(); }}>
        پرش به محتوا
      </a>
      <header className="topbar">
        <span className="brand">جریان ما · مدیریت</span>
        <span className="who" dir="ltr">{user.email}</span>
      </header>
      <nav className="nav" aria-label="بخش‌های مدیریت">
        {NAV.filter((item) => !("permission" in item) || can(item.permission)).map((item) => (
          <a key={item.path} href={hrefFor(item.path)} aria-current={route.path.startsWith(item.path) ? "page" : undefined}>
            <Icon name={item.icon} />
            {item.label}
            {item.path === "/orders" && orders.pending > 0 && <span className="nav-badge" data-testid="orders-badge" aria-label={`${orders.pending.toLocaleString("fa-IR")} سفارش در انتظار تأیید`}>{orders.pending.toLocaleString("fa-IR")}</span>}
          </a>
        ))}
      </nav>
      <main id="main" className="main" tabIndex={-1} ref={mainRef}>
        {orders.pending > 0 && segments[0] !== "orders" && (
          <a className="attention-banner" href={hrefFor("/orders", { status: "pending" })} role="status" data-testid="pending-banner">
            {orders.pending.toLocaleString("fa-IR")} سفارش در انتظار تأیید دارید. برای بررسی بزنید.
          </a>
        )}
        {page}
      </main>
    </div>
  );
}

export function App() {
  const { state, retry } = useSession();
  if (state.status === "loading") return <div className="boot-message"><Loading label="در حال بررسی نشست…" /></div>;
  if (state.status === "error") {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <Alert tone="error" title="ارتباط با سرور برقرار نشد" action={<Button onClick={retry}>تلاش دوباره</Button>}>
            اینترنت خود را بررسی کنید. برای امنیت، اطلاعات مدیریتی در حالت آفلاین نگه‌داری نمی‌شود.
          </Alert>
        </div>
      </div>
    );
  }
  if (state.status === "anonymous") return <LoginPage expired={state.expired} />;
  return <Shell />;
}

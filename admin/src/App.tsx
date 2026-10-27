import { useEffect, useRef } from "react";
import { hrefFor, isProductId, useRoute } from "./router";
import { useSession, useUser } from "./session";
import { Button } from "./ui/controls";
import { Alert, Loading } from "./ui/feedback";
import { Icon } from "./ui/Icon";
import { AccountPage } from "./pages/AccountPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { DataPage } from "./pages/DataPage";
import { LoginPage } from "./pages/LoginPage";
import { ProductEditorPage } from "./pages/ProductEditorPage";
import { ProductsPage } from "./pages/ProductsPage";

const NAV = [
  { path: "/products", label: "محصولات", icon: "products" },
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
  const mainRef = useRef<HTMLElement>(null);
  const title = titleFor(route.path);

  useEffect(() => {
    document.title = `${title} | مدیریت جریان ما`;
    mainRef.current?.focus();
    window.scrollTo(0, 0);
  }, [title, route.path]);

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
  else if (segments[0] === "data") page = <DataPage />;
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
        {NAV.map((item) => (
          <a key={item.path} href={hrefFor(item.path)} aria-current={route.path.startsWith(item.path) ? "page" : undefined}>
            <Icon name={item.icon} />
            {item.label}
          </a>
        ))}
      </nav>
      <main id="main" className="main" tabIndex={-1} ref={mainRef}>
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

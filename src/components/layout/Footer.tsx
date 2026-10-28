import { Container } from "@/components/ui/Container";
import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { navLinks, site } from "@/lib/site";
import { Wordmark } from "./Wordmark";

export function Footer() {
  return (
    <footer className="mt-16 bg-teal-900 pb-24 text-sand-100 md:mt-24 md:pb-0">
      <Container className="grid gap-10 py-14 md:grid-cols-3">
        <div>
          <Wordmark className="text-5xl text-ivory-50" />
          <p className="mt-3 text-sand-200">{site.slogan}</p>
        </div>
        <nav aria-label="پیوندهای پایین صفحه">
          <p className="mb-3 text-sm font-medium text-sand-300">دسترسی سریع</p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-1">
            {navLinks.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="inline-flex min-h-11 items-center hover:text-ivory-50">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <p className="mb-3 text-sm font-medium text-sand-300">ما را دنبال کنید</p>
          <a href={site.instagramUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 hover:text-ivory-50">
            <InstagramIcon />
            <span dir="ltr">@{site.instagramHandle}</span>
          </a>
        </div>
      </Container>
      <div className="border-t border-ivory-50/15">
        <Container className="py-5 text-xs leading-6 text-sand-200">
          نسخه نمایشی؛ محصولات، تصاویر و متن‌های دارای برچسب «نمونه» واقعی نیستند. فقط نام گالری، شعار و حساب اینستاگرام تأیید شده‌اند. © {site.name}
        </Container>
      </div>
    </footer>
  );
}

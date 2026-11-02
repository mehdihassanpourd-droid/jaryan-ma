import { Container } from "@/components/ui/Container";
import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { navLinks, site } from "@/lib/site";
import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="mt-24 bg-burgundy-600 pb-24 text-ivory-100 md:mt-40 md:pb-0">
      <Container className="grid gap-8 py-10 md:grid-cols-12 md:gap-8 md:py-24">
        <div className="md:col-span-5">
          <Logo height={168} className="h-24 w-auto md:h-[10.5rem]" />
          <p className="mt-4 text-xl font-black text-ivory-50">{site.name}</p>
          <p className="mt-1 text-ivory-200">{site.slogan}</p>
        </div>
        <nav aria-label="پیوندهای پایین صفحه" className="md:col-span-4 md:col-start-7">
          <p className="mb-3 border-t-2 border-ivory-200 pt-2 text-sm font-bold text-ivory-200">دسترسی سریع</p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-1">
            {navLinks.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="inline-flex min-h-11 items-center hover:text-ivory-50 hover:underline hover:underline-offset-8">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="md:col-span-2">
          <p className="mb-3 border-t-2 border-ivory-200 pt-2 text-sm font-bold text-ivory-200">ما را دنبال کنید</p>
          <a href={site.instagramUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 hover:text-ivory-50">
            <InstagramIcon />
            <span dir="ltr">@{site.instagramHandle}</span>
          </a>
        </div>
      </Container>
      <div className="border-t border-ivory-50/20">
        <Container className="py-5 text-xs leading-6 text-ivory-200">
          نسخه نمایشی؛ محصولات، تصاویر و متن‌های دارای برچسب «نمونه» واقعی نیستند. فقط نام گالری، شعار، حساب اینستاگرام و معرفی کلی برند تأیید شده‌اند. © {site.name}
        </Container>
      </div>
    </footer>
  );
}

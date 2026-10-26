import { Container } from "@/components/ui/Container";
import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { WovenDivider } from "@/components/ui/WovenDivider";
import { navLinks, site } from "@/lib/site";

export function Footer() {
  return (
    <footer className="bg-bark-900 pb-28 text-sand-100 md:pb-0">
      <WovenDivider className="text-bark-600" />
      <Container className="grid gap-10 py-14 md:grid-cols-3">
        <div>
          <p className="text-2xl font-extrabold text-ivory-50">{site.name}</p>
          <p className="mt-2 text-sand-300">{site.slogan}</p>
        </div>
        <nav aria-label="پیوندهای پایین صفحه">
          <p className="mb-3 text-sm font-medium text-sand-300">دسترسی سریع</p>
          <ul className="space-y-2">
            {navLinks.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="hover:text-ivory-50">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <p className="mb-3 text-sm font-medium text-sand-300">ما را دنبال کنید</p>
          <a
            href={site.instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 hover:text-ivory-50"
          >
            <InstagramIcon />
            <span dir="ltr">@{site.instagramHandle}</span>
          </a>
        </div>
      </Container>
      <div className="border-t border-bark-700">
        <Container className="py-5 text-xs leading-6 text-sand-300">
          نسخه نمایشی؛ محصولات، تصاویر و متن‌های دارای برچسب «نمونه» واقعی نیستند. © {site.name}
        </Container>
      </div>
    </footer>
  );
}

import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";

export default function NotFound() {
  return (
    <Container className="py-32 text-center">
      <h1 className="border-t-4 border-bark-900 pt-3 text-4xl font-black leading-tight text-bark-900">صفحه‌ای پیدا نشد</h1>
      <p className="mt-3 text-bark-600">شاید آدرس تغییر کرده باشد. از صفحه‌ی اصلی دوباره شروع کنید.</p>
      <div className="mt-6">
        <ButtonLink href="/">بازگشت به خانه</ButtonLink>
      </div>
    </Container>
  );
}

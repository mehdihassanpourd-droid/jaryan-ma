import type { CsvIssue } from "@/domain/product/csv";
import { messageFa } from "@/domain/product/messages.fa";

const CSV_CODES: Record<string, string> = {
  csv_too_large: "فایل از حد مجاز (حدود ۲ مگابایت) بزرگ‌تر است؛ آن را به چند فایل تقسیم کنید.",
  csv_unterminated_quote: "یک گیومه (\") در فایل بسته نشده است.",
  csv_empty: "فایل خالی است.",
  csv_too_many_rows: "تعداد ردیف‌ها از حد مجاز بیشتر است.",
  unknown_column: "ستونی ناشناخته است.",
  duplicate_column: "ستون تکراری است.",
  missing_column: "ستون ضروری وجود ندارد.",
  too_many_cells: "این ردیف از سربرگ ستون بیشتری دارد.",
  slug_required: "نشانی (slug) ردیف خالی است.",
  conflicting_product_fields: "ردیف‌های یک محصول در این ستون مقدار متفاوت دارند.",
  invalid_number: "عدد معتبر نیست (فقط رقم صحیح).",
  unknown_category: "دسته‌بندی با این نشانی (category_slug) وجود ندارد.",
  invalid_variant_options: "قالب ویژگی‌ها باید «نام=مقدار|نام=مقدار» باشد.",
  forbidden: "شما اجازهٔ انتشار ندارید؛ وضعیت را روی draft بگذارید.",
};

export const csvIssueMessage = (issue: Pick<CsvIssue, "code">): string => CSV_CODES[issue.code] ?? messageFa(issue.code);

/** Downloads text as a file. Works on Android Chrome (saved to Downloads) and desktop. */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Runs `worker` over `items` with a bounded number in flight. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/**
 * Starter FAQ (Persian). Everything is seeded UNPUBLISHED on purpose: the owner reviews each answer
 * and publishes it when it is true for the live shop. Answers about policies the business has not
 * decided yet (shipping, returns, prices, payment) contain no invented facts: they only say the policy
 * will be added, and must be edited before publishing.
 */
interface SeedItem {
  categorySlug: string;
  slug: string;
  question: string;
  answer: string;
  position: number;
  published: boolean;
}

const TODO = "این پاسخ پس از تعیین سیاست فروشگاه توسط مدیر تکمیل می‌شود. پیش از انتشار، متن را ویرایش کنید.";

export const DEFAULT_FAQ: { categories: Array<{ slug: string; title: string; position: number }>; items: SeedItem[] } = {
  categories: [
    { slug: "account", title: "حساب کاربری", position: 1 },
    { slug: "orders", title: "سفارش و ارسال", position: 2 },
    { slug: "privacy", title: "حریم خصوصی", position: 3 },
    { slug: "support", title: "پشتیبانی", position: 4 },
  ],
  items: [
    {
      categorySlug: "account",
      slug: "how-to-sign-in",
      question: "چگونه وارد حساب کاربری شوم؟",
      answer: "شماره موبایل خود را وارد کنید. یک کد شش‌رقمی پیامک می‌شود؛ آن را وارد کنید تا وارد شوید. رمز عبور لازم نیست و اگر برای اولین بار وارد می‌شوید، حساب شما ساخته می‌شود.",
      position: 1,
      published: false,
    },
    {
      categorySlug: "account",
      slug: "no-sms-code",
      question: "کد پیامکی به دستم نرسید، چه کنم؟",
      answer: "کمی صبر کنید و دوباره درخواست دهید؛ کد جدید حداقل یک دقیقه بعد از کد قبلی ارسال می‌شود. به خاطر امنیت، تعداد درخواست‌ها در هر ساعت و روز محدود است. کد را هرگز به کسی نگویید؛ ما هیچ‌وقت کد را از شما نمی‌پرسیم.",
      position: 2,
      published: false,
    },
    {
      categorySlug: "account",
      slug: "multiple-addresses",
      question: "می‌توانم چند آدرس ذخیره کنم؟",
      answer: "بله، در بخش آدرس‌های حساب کاربری می‌توانید تا ۱۰ آدرس ذخیره کنید و یکی را به‌عنوان آدرس پیش‌فرض انتخاب کنید.",
      position: 3,
      published: false,
    },
    {
      categorySlug: "orders",
      slug: "delivery-time",
      question: "ارسال سفارش چقدر طول می‌کشد؟",
      answer: TODO,
      position: 1,
      published: false,
    },
    {
      categorySlug: "orders",
      slug: "returns",
      question: "شرایط مرجوعی چیست؟",
      answer: TODO,
      position: 2,
      published: false,
    },
    {
      categorySlug: "orders",
      slug: "made-to-order",
      question: "سفارش‌های ساخت اختصاصی چقدر زمان می‌برند؟",
      answer: TODO,
      position: 3,
      published: false,
    },
    {
      categorySlug: "privacy",
      slug: "export-my-data",
      question: "چگونه اطلاعات حسابم را دریافت کنم؟",
      answer: "از بخش حساب کاربری می‌توانید یک فایل شامل مشخصات، آدرس‌ها، علاقه‌مندی‌ها، سفارش‌ها و گفتگوهای پشتیبانی خود را دریافت کنید. این فایل یادداشت‌های داخلی تیم را شامل نمی‌شود.",
      position: 1,
      published: false,
    },
    {
      categorySlug: "privacy",
      slug: "delete-my-account",
      question: "چگونه حسابم را حذف کنم؟",
      answer: "از بخش حساب کاربری درخواست حذف دهید. ۱۴ روز فرصت دارید نظرتان را عوض کنید و حذف را لغو کنید؛ پس از آن اطلاعات شخصی شما (نام، شماره موبایل، آدرس‌ها، علاقه‌مندی‌ها و متن گفتگوها) برگشت‌ناپذیر پاک می‌شود. فقط مبلغ و تاریخ سفارش‌ها بدون مشخصات شخصی نگه داشته می‌شود. تا زمانی که سفارش باز دارید نمی‌توانید حذف را شروع کنید.",
      position: 2,
      published: false,
    },
    {
      categorySlug: "support",
      slug: "contact-support",
      question: "چگونه با پشتیبانی تماس بگیرم؟",
      answer: "از بخش پشتیبانی حساب کاربری یک تیکت باز کنید و در صورت نیاز سفارش مربوط را انتخاب کنید. پاسخ تیم در همان تیکت نمایش داده می‌شود و می‌توانید گفتگو را ادامه دهید.",
      position: 1,
      published: false,
    },
    {
      categorySlug: "support",
      slug: "ticket-limits",
      question: "چرا نمی‌توانم تیکت جدید باز کنم؟",
      answer: "برای جلوگیری از سوءاستفاده، تعداد تیکت‌ها و پیام‌ها در هر ساعت و روز محدود است و هم‌زمان حداکثر ۱۰ تیکت باز می‌توانید داشته باشید. تیکت‌های حل‌شده را ببندید یا کمی بعد دوباره تلاش کنید.",
      position: 2,
      published: false,
    },
  ],
};

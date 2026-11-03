# نصب امن تایمرهای systemd (پشتیبان، اعتبارسنجی، آزمون بازیابی)

قالب‌ها در `ops/systemd/` هستند و **نمونه**‌اند: قبل از نصب مسیرها را مطابق سرور خود ویرایش کنید (خطوط `EDIT`). با راهنمای `docs/admin/SELF-HOSTING.md` هم‌خوان‌اند: کاربر `jaryan`، برنامه در `/opt/jaryan-ma`، فایل‌های محیطی در `/etc/jaryan-ma/`.

| واحد | زمان‌بندی نمونه | کار |
|---|---|---|
| `jaryan-backup` | هر شب ۰۳:۳۰ | `ops backup`: `pg_dump` رمزنگاری‌شده + manifest (شامل اثر انگشت محتوای هر جدول) |
| `jaryan-backup-verify` | هر شب ۰۴:۱۵ | `ops backup-verify`: بررسی آفلاین (checksum، سن، رمزگشایی، خواندن ساختار). بدون اتصال به پایگاه‌داده؛ **بازیابی‌پذیری را ثابت نمی‌کند** |
| `jaryan-restore-drill` | یکشنبه‌ها ۰۵:۰۰ | `restore-drill.sh`: اعتبارسنجی + بازیابی در پایگاه‌دادهٔ موقت روی **سرور آزمایشی** + مقایسهٔ تعداد ردیف، محتوا و تاریخچهٔ مایگریشن. فقط این مرحله وضعیت پشتیبان را «عملیاتی» می‌کند |

## ۱. پیش‌نیازها و مجوزها
```bash
# کاربر و پوشه‌ها (اگر هنوز نساخته‌اید؛ SELF-HOSTING.md)
sudo install -d -o jaryan -g jaryan -m 0700 /var/backups/jaryan     # فقط خود کاربر؛ بیرون از ریشهٔ وب و از nginx
sudo install -d -o root   -g jaryan -m 0750 /etc/jaryan-ma

# فایل محیطی عملیات (از ops/systemd/ops.env.example کپی و پر کنید)
sudo install -o root -g jaryan -m 0640 ops/systemd/ops.env.example /etc/jaryan-ma/ops.env
sudoedit /etc/jaryan-ma/ops.env

# فایل سرور آزمایشی (فقط برای آزمون بازیابی)
sudo install -o jaryan -g jaryan -m 0600 ops/systemd/restore-drill.env.example /etc/jaryan-ma/restore-drill.env
sudoedit /etc/jaryan-ma/restore-drill.env
```
- **کلید رمزنگاری** (`BACKUP_ENCRYPTION_KEY`, `openssl rand -base64 32`) را یک نسخه **بیرون از سرور** نگه دارید؛ بدون آن پشتیبان‌ها خوانا نیستند. هرگز در git، لاگ یا گزارش قرار ندهید.
- پوشهٔ پشتیبان `0700` است و فایل‌ها با `UMask=0077` ساخته می‌شوند. این پوشه نباید توسط nginx یا هیچ مسیر HTTP سرو شود؛ API هم فایل پشتیبان را برنمی‌گرداند (فقط ثبت متادیتا برای مالک).
- فایل‌های `*.env.example` فقط الگو هستند و مقدار واقعی ندارند؛ نسخهٔ واقعی را در git نگذارید.

## ۲. آزمون بازیابی هرگز روی تولید نمی‌نویسد
- بازیابی فقط در یک پایگاه‌دادهٔ تازه به نام `jm_restore_test_<تصادفی>` انجام و بعد حذف می‌شود؛ هرگز روی پایگاه‌دادهٔ برنامه.
- `restore-drill.sh` اگر `RESTORE_TEST_ADMIN_URL` هم‌ماشین/هم‌پورت با `DATABASE_URL` باشد (همهٔ شکل‌های `localhost`، `127.x`، `::1` یکی حساب می‌شوند) با کد ۶۴ متوقف می‌شود و هیچ‌چیز اجرا نمی‌کند.
- سرور آزمایشی را **جدا** بگیرید: یک VPS دیگر یا یک نمونهٔ PostgreSQL دیگر با دایرکتوری داده و پورت متفاوت، با نقشی که فقط `CREATEDB` دارد و به داده‌های تولید دسترسی ندارد.
- `ALLOW_SAME_SERVER=yes` را فقط برای سرور یک‌بارمصرف (مثل CI) استفاده کنید؛ در واحد systemd تنظیم نشده است.
- واحدها `NoNewPrivileges`، `ProtectSystem=strict`، `ProtectHome`، `PrivateTmp` و `ReadWritePaths` فقط برای پوشهٔ پشتیبان دارند.

## ۳. نصب
```bash
sudo cp ops/systemd/jaryan-*.service ops/systemd/jaryan-*.timer /etc/systemd/system/
sudoedit /etc/systemd/system/jaryan-backup.service        # مسیرها (WorkingDirectory، ReadWritePaths) را مطابق سرور تنظیم کنید؛ برای دو واحد دیگر هم
sudo systemd-analyze verify /etc/systemd/system/jaryan-*.service /etc/systemd/system/jaryan-*.timer
sudo systemctl daemon-reload

# یک‌بار دستی اجرا و نتیجه را ببینید (قبل از فعال‌سازی تایمر)
sudo systemctl start jaryan-backup.service        && journalctl -u jaryan-backup.service -n 20 --no-pager
sudo systemctl start jaryan-backup-verify.service && journalctl -u jaryan-backup-verify.service -n 20 --no-pager
# آزمون بازیابی را فقط پس از آماده شدن سرور آزمایشی اجرا کنید
sudo systemctl start jaryan-restore-drill.service && journalctl -u jaryan-restore-drill.service -n 30 --no-pager

sudo systemctl enable --now jaryan-backup.timer jaryan-backup-verify.timer jaryan-restore-drill.timer
systemctl list-timers 'jaryan-*'
```
زمان‌ها به ساعت محلی سرور هستند. اگر سرویسی شکست بخورد، `systemctl status` وضعیت `failed` نشان می‌دهد؛ بررسی `journalctl` و `npm run ops -- backup-status` را در برنامهٔ هفتگی بگذارید. وضعیت «عملیاتی» فقط پس از موفقیت `jaryan-restore-drill` و تازه بودن آن در `backup-status` دیده می‌شود.

## ۴. عیب‌یابی سریع
- کد خروج ۶۴ در drill: پیکربندی ناامن یا ناقص (سرور آزمایشی همان تولید است، متغیر یا پوشه موجود نیست). پیام روی `journalctl` توضیح می‌دهد.
- `backup_key_required`/`backup_key_invalid`: `BACKUP_ENCRYPTION_KEY` در `ops.env` درست نیست.
- `pg_dump`/`pg_restore` پیدا نمی‌شود: بستهٔ `postgresql-client-16` (هم‌نسخه با سرور) را نصب کنید.

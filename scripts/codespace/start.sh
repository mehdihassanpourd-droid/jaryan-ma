#!/usr/bin/env bash
# Starts the admin app + API on this Codespace's PRIVATE forwarded URL.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

origin="$(public_origin)"
start_db
export_server_env
export ADMIN_ORIGINS="$origin" PUBLIC_MEDIA_URL="$origin/media"
cd "$ROOT"

[ -f dist/admin/index.html ] || { say "ساخت برنامهٔ مدیریت…"; npm run --silent admin:build; }

enrolled="$(PGPASSWORD="$(db_password)" "$PG_BIN/psql" -h 127.0.0.1 -p "$PG_PORT" -U jaryan -d jaryan -tAc 'SELECT count(*) FROM admin_users WHERE "totpSecretEnc" IS NOT NULL' 2>/dev/null || echo 0)"
[ "${enrolled:-0}" -ge 1 ] || die "هنوز مدیری با ورود دومرحله‌ای ساخته نشده است. اجرا کنید: npm run codespace:admin -- you@example.com"

# The forwarded port must stay private (GitHub login in front of the admin login). Best effort: GitHub's own CLI.
guard_port() {
  [ "${CODESPACES:-}" = "true" ] && command -v gh >/dev/null 2>&1 || return 0
  for _ in $(seq 1 30); do
    sleep 2
    vis="$(gh codespace ports -c "${CODESPACE_NAME:-}" --json sourcePort,visibility -q ".[] | select(.sourcePort==${APP_PORT}) | .visibility" 2>/dev/null || true)"
    [ -n "$vis" ] || continue
    if [ "$vis" != "private" ]; then
      echo "⚠ پورت ${APP_PORT} خصوصی نبود؛ در حال خصوصی‌کردن…" >&2
      gh codespace ports visibility "${APP_PORT}:private" -c "${CODESPACE_NAME:-}" >/dev/null 2>&1 || echo "⚠ نشد. در تب Ports پورت را دستی روی Private بگذارید!" >&2
    fi
    return 0
  done
  echo "⚠ وضعیت پورت بررسی نشد. در تب Ports مطمئن شوید Visibility = Private است." >&2
}
guard_port &

echo
echo "نشانی خصوصی برنامهٔ مدیریت (فقط با ورود به GitHub باز می‌شود):"
echo "  $origin/admin/"
echo "برای توقف: Ctrl+C"
echo
exec npx tsx server/main.ts

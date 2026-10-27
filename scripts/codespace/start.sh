#!/usr/bin/env bash
# Starts the admin app + API on this Codespace's PRIVATE forwarded URL.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

origin="$(public_origin)"
start_db
export_server_env
export ADMIN_ORIGINS="$origin" PUBLIC_MEDIA_URL="$origin/media"
# Behind GitHub's forwarder the browser's Origin is the host it addressed. Besides the exact origin above, the server (development
# only) accepts an https Origin that equals the host of the request itself and ends with this suffix (".app.github.dev").
host="${origin#https://}"
export ADMIN_ORIGIN_HOST_SUFFIXES=".${host#*.}"
# GitHub's forwarder REWRITES Origin and Host to the upstream address: the server sees "Origin: http://localhost:3001" even though
# the browser is on the https://...app.github.dev URL. Accept exactly that loopback origin of this server own port (development only;
# production refuses the setting). A foreign Referer still vetoes it. See docs/admin/ADMIN-APP.md.
export ADMIN_ACCEPT_REWRITTEN_ORIGIN=true
cd "$ROOT"
export APP_COMMIT="$(git rev-parse --short=7 HEAD 2>/dev/null || true)"
[ -n "$APP_COMMIT" ] || unset APP_COMMIT

# Build when missing OR older than the sources (a pulled update must not run a stale app).
if [ ! -f dist/admin/index.html ] || [ -n "$(find admin/src admin/index.html admin/public scripts/admin -type f -newer dist/admin/index.html -print -quit 2>/dev/null)" ]; then
  say "ساخت برنامهٔ مدیریت…"
  npm run --silent admin:build
fi

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
echo "اگر هنوز مدیری ندارید، همان صفحه برای ساخت مدیر اول (گذرواژه + کد دومرحله‌ای) باز می‌شود."
echo "برای توقف: Ctrl+C"
echo
exec npx tsx server/main.ts

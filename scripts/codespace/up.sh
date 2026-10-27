#!/usr/bin/env bash
# Starts the admin app in the BACKGROUND (if it is not already running) and prints its private URL. Runs by itself every
# time the Codespace starts, so nobody has to type a command: open the Ports tab (or the notification) and tap the link.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

origin="$(public_origin)"
mkdir -p "$STATE"

if ! app_up; then
  say "راه‌اندازی برنامهٔ مدیریت در پس‌زمینه…"
  setsid nohup bash "$ROOT/scripts/codespace/start.sh" >"$STATE/server.log" 2>&1 < /dev/null &
  echo $! > "$STATE/server.pid"   # its own session/process group, so down.sh can stop the whole tree
  for _ in $(seq 1 90); do
    app_up && break
    sleep 1
  done
fi

if app_up; then
  echo "برنامهٔ مدیریت آماده است: $origin/admin/"
else
  echo "برنامه بالا نیامد. آخرین خطوط گزارش:" >&2
  tail -n 25 "$STATE/server.log" >&2 || true
  exit 1
fi

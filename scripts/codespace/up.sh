#!/usr/bin/env bash
# Starts the admin app in the BACKGROUND (if it is not already running) and prints its private URL. Runs by itself every
# time the Codespace starts, so nobody has to type a command: open the Ports tab (or the notification) and tap the link.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

origin="$(public_origin)"
mkdir -p "$STATE"

# Every start first looks for a newer main (safe fast-forward only, see update.sh). If the code changed while an old copy of the
# app is still running, stop it so the new code starts; then re-run THIS script from the start, because it may just have been replaced.
if [ -z "${JARYAN_UPDATED:-}" ]; then
  before="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo none)"
  bash "$ROOT/scripts/codespace/update.sh" >>"$STATE/update.log" 2>&1 || true
  tail -n 3 "$STATE/update.log" 2>/dev/null | sed 's/^/  /'
  after="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo none)"
  [ "$before" = "$after" ] || bash "$ROOT/scripts/codespace/down.sh" || true
  JARYAN_UPDATED=1 exec bash "$ROOT/scripts/codespace/up.sh" "$@"
fi

if ! app_up; then
  say "راه‌اندازی برنامهٔ مدیریت در پس‌زمینه…"
  setsid nohup bash "$ROOT/scripts/codespace/start.sh" >"$STATE/server.log" 2>&1 < /dev/null &
  echo $! > "$STATE/server.pid"   # its own session/process group, so down.sh can stop the whole tree
  for _ in $(seq 1 90); do
    app_up && break
    sleep 1
  done
fi

# One background watcher per Codespace: picks up later merges to main without any action from the user.
if [ -z "${JARYAN_NO_WATCH:-}" ] && ! { [ -f "$STATE/watch.pid" ] && kill -0 "$(cat "$STATE/watch.pid")" 2>/dev/null; }; then
  setsid nohup bash "$ROOT/scripts/codespace/watch.sh" >>"$STATE/update.log" 2>&1 < /dev/null &
  echo $! > "$STATE/watch.pid"
fi

if app_up; then
  echo "برنامهٔ مدیریت آماده است: $origin/admin/ (نسخه $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo ?))"
else
  echo "برنامه بالا نیامد. آخرین خطوط گزارش:" >&2
  tail -n 25 "$STATE/server.log" >&2 || true
  exit 1
fi

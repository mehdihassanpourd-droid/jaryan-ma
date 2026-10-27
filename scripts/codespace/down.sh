#!/usr/bin/env bash
# Stops the background admin app started by up.sh (the database keeps running; your data stays).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [ -f "$STATE/server.pid" ]; then
  pid="$(cat "$STATE/server.pid")"
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  rm -f "$STATE/server.pid"
fi
for _ in $(seq 1 20); do app_up || { say "برنامهٔ مدیریت متوقف شد."; exit 0; }; sleep 0.5; done
die "برنامه هنوز در حال اجراست."

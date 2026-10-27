#!/usr/bin/env bash
# Background loop started by up.sh: every few minutes it looks for a newer main (update.sh) and, if the checkout changed,
# restarts the app on the new code. Needs no token (the Codespace already has access to its own repository).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

INTERVAL="${JARYAN_UPDATE_INTERVAL:-900}"
cd "$ROOT"
while true; do
  sleep "$INTERVAL"
  before="$(git rev-parse HEAD 2>/dev/null || echo none)"
  bash "$ROOT/scripts/codespace/update.sh" >>"$STATE/update.log" 2>&1 || true
  after="$(git rev-parse HEAD 2>/dev/null || echo none)"
  if [ "$before" != "$after" ]; then
    echo "[watch] new version $(git rev-parse --short HEAD): restarting" >>"$STATE/update.log"
    rm -f "$STATE/watch.pid"
    bash "$ROOT/scripts/codespace/down.sh" >>"$STATE/update.log" 2>&1 || true
    # A fresh up.sh (the file may just have been replaced) restarts the app and starts a new watcher; this loop ends here.
    exec env JARYAN_UPDATED=1 bash "$ROOT/scripts/codespace/up.sh" >>"$STATE/update.log" 2>&1
  fi
done

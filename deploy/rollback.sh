#!/usr/bin/env bash
# Switches the APPLICATION back to an installed earlier release (default: the one before the current). The database is never
# changed: migrations are not reversed (see docs/maintenance/ROLLBACK-FA.md for when that is and is not safe).
#
#   sudo ./deploy/rollback.sh [--to <version>] [--list]
set -euo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd -P)"
. "$HERE/lib.sh"
TO="" LIST=0
while [ $# -gt 0 ]; do case "$1" in --to) TO="${2:?}"; shift 2 ;; --list) LIST=1; shift ;; *) die "unknown option $1" 64 ;; esac; done
need curl
if [ -z "$JM_PREFIX" ] && [ "$(id -u)" != 0 ]; then die "run as root (sudo), or set JM_PREFIX" 64; fi

CUR="$(current_release || true)"
if [ "$LIST" = 1 ]; then
  echo "current: ${CUR:-none}"; echo "previous: $(previous_release || true)"; echo "installed:"
  ls -1t "$JM_APP_ROOT/releases" 2>/dev/null | sed 's/^/  /'
  exit 0
fi
TARGET="${TO:-$(previous_release)}"
[ -n "$TARGET" ] || die "no previous release is recorded; use --list and --to <version>" 64
[[ "$TARGET" =~ ^[0-9A-Za-z][0-9A-Za-z._-]{0,40}$ ]] || die "invalid version" 64
[ "$TARGET" != "$CUR" ] || die "release $TARGET is already the current one" 64
[ -d "$JM_APP_ROOT/releases/$TARGET" ] || die "release $TARGET is not installed here (--list shows what is)" 64

# a damaged installed release must not be switched to
( cd "$JM_APP_ROOT/releases/$TARGET" && sha256sum --check --quiet SHA256SUMS ) || die "installed release $TARGET fails its checksum check; refusing to switch to it"

if [ -n "$CUR" ]; then echo "$CUR" > "$JM_STATE_DIR/previous"; fi
point_to_release "$TARGET"
log "switched the application from ${CUR:-none} to $TARGET; restarting"
svc restart || warn "restart command failed"
if wait_ready && verify_running; then
  record "rollback ${CUR:-none} -> $TARGET ok"
  log "DONE: release $TARGET is running and healthy."
  log "NOTE: the database was not changed. If $CUR applied migrations they are still there; read ROLLBACK-FA.md before any database action."
  exit 0
fi
record "rollback ${CUR:-none} -> $TARGET FAILED health verification"
die "release $TARGET did not become healthy; check the service log and ROLLBACK-FA.md" 2

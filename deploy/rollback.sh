#!/usr/bin/env bash
# Switches the APPLICATION back to an installed earlier release (default: the one before the current). The database is never
# changed: migrations are not reversed (see docs/maintenance/ROLLBACK-FA.md for when that is and is not safe).
#
#   sudo ./deploy/rollback.sh [--to <version>] [--list] [--accept-newer-schema]
#
# Before switching it checks that the DATABASE is compatible with the target release (read-only). Exit codes:
#   0 done · 2 target did not become healthy · 64 usage · 65 REFUSED: the database has migrations the target does not know
#   (override only with --accept-newer-schema, after a person has verified compatibility) · 66 REFUSED: unfinished/modified
#   migration · 67 REFUSED: target needs migrations that are not applied · 68 REFUSED: compatibility could not be determined.
#   66/67/68 can never be overridden. Nothing here ever reverses a migration.
set -euo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd -P)"
. "$HERE/lib.sh"
TO="" LIST=0 ACCEPT_NEWER=0
while [ $# -gt 0 ]; do case "$1" in --to) TO="${2:?}"; shift 2 ;; --list) LIST=1; shift ;; --accept-newer-schema) ACCEPT_NEWER=1; shift ;; *) die "unknown option $1" 64 ;; esac; done
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

# Schema compatibility gate: BEFORE anything is switched.
SCHEMA_RC=0; schema_check "$JM_APP_ROOT/releases/$TARGET" || SCHEMA_RC=$?
if [ "$SCHEMA_RC" != 0 ]; then
  EXPLAIN="$(schema_explain "$SCHEMA_STATE")"
  if [ "$SCHEMA_RC" = 65 ] && [ "$ACCEPT_NEWER" = 1 ]; then
    warn "SCHEMA AHEAD ACCEPTED BY THE OPERATOR (--accept-newer-schema): $EXPLAIN"
    warn "the application will run against a database that is newer than it. Nothing is reversed. Verify the application's behaviour and keep watching /health (degraded) until a compatible release is installed."
    record "rollback ${CUR:-none} -> $TARGET: newer schema ACCEPTED by operator ($SCHEMA_DETAIL)"
  else
    record "rollback ${CUR:-none} -> $TARGET REFUSED: schema $SCHEMA_STATE ($SCHEMA_DETAIL)"
    warn "ROLLBACK REFUSED, nothing was changed: $EXPLAIN"
    case "$SCHEMA_RC" in
      65) warn "options: (1) install a newer, fixed release (forward-fix, preferred); (2) verify by hand that $TARGET works with the extra migrations, then re-run with --accept-newer-schema; (3) restore a backup into a scratch database first (see ROLLBACK-FA.md). The database is never reversed automatically." ;;
      *)  warn "this state cannot be overridden: see ROLLBACK-FA.md" ;;
    esac
    exit "$SCHEMA_RC"
  fi
fi

if [ -n "$CUR" ]; then echo "$CUR" > "$JM_STATE_DIR/previous"; fi
point_to_release "$TARGET"
log "switched the application from ${CUR:-none} to $TARGET; restarting"
svc restart || warn "restart command failed"
if wait_ready && verify_running; then
  record "rollback ${CUR:-none} -> $TARGET ok"
  log "DONE: release $TARGET is running and healthy."
  log "NOTE: the database was not changed (migrations are never reversed). Run ./deploy/verify.sh to see the schema state."
  exit 0
fi
record "rollback ${CUR:-none} -> $TARGET FAILED health verification"
die "release $TARGET did not become healthy; check the service log and ROLLBACK-FA.md" 2

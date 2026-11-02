#!/usr/bin/env bash
# Safe restore drill: verify the newest backup offline, then restore it into a SCRATCH PostgreSQL server and compare it with
# the manifest. Never touches the production database: it refuses to run if the scratch server is the production server.
#
#   RESTORE_TEST_ADMIN_URL=postgresql://admin:...@scratch-host:5432/postgres \
#   DATABASE_URL=...  BACKUP_DIR=/var/backups/jaryan  BACKUP_ENCRYPTION_KEY=...  scripts/maintenance/restore-drill.sh
#
# Exit codes: 0 verified and restored; 1 failed; 64 unsafe or incomplete configuration (nothing was run).
set -euo pipefail

die() { echo "restore-drill: $*" >&2; exit 64; }

[ -n "${RESTORE_TEST_ADMIN_URL:-}" ] || die "RESTORE_TEST_ADMIN_URL is required (CREATEDB connection to a scratch server)"
[ -n "${BACKUP_DIR:-}" ] || die "BACKUP_DIR is required"
[ -d "$BACKUP_DIR" ] || die "BACKUP_DIR does not exist"

# host:port of a connection URL; every loopback spelling is one machine, and the default port is 5432
host_of() {
  local rest host port
  rest="${1#*://}"; rest="${rest#*@}"; rest="${rest%%/*}"; rest="${rest%%\?*}"
  case "$rest" in
    \[*\]*) host="${rest%%]*}]"; port="${rest#*]}"; port="${port#:}" ;;
    *) host="${rest%%:*}"; port="${rest#*:}"; [ "$port" = "$rest" ] && port="" ;;
  esac
  host="$(printf '%s' "$host" | tr 'A-Z' 'a-z')"
  case "$host" in localhost|127.*|"[::1]"|::1|0.0.0.0|"") host="loopback" ;; esac
  printf '%s:%s' "$host" "${port:-5432}"
}
if [ -n "${DATABASE_URL:-}" ] && [ "$(host_of "$RESTORE_TEST_ADMIN_URL")" = "$(host_of "$DATABASE_URL")" ] && [ "${ALLOW_SAME_SERVER:-}" != "yes" ]; then
  die "the scratch server is the production server; use a separate one (or set ALLOW_SAME_SERVER=yes to accept the extra load, the restore still goes into a new throw-away database)"
fi

echo "== 1/2 offline verification =="
npm run --silent ops -- backup-verify
echo "== 2/2 restore into a throw-away database =="
if [ "${ALLOW_SAME_SERVER:-}" = "yes" ]; then
  npm run --silent ops -- restore-test --allow-same-server
else
  npm run --silent ops -- restore-test
fi
echo "restore-drill: finished. Check \`npm run ops -- backup-status\` for the recorded state."

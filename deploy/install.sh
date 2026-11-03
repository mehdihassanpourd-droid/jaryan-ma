#!/usr/bin/env bash
# Installs or upgrades Jaryan Ma from an offline release package. No network access, npm, git or Prisma CLI is used.
#
#   sudo ./deploy/install.sh --package jaryan-ma-<version>-linux-x64.tar.xz     install / upgrade
#   sudo ./deploy/install.sh --package ... --dry-run                             verify + show what would happen; changes nothing
#   sudo ./deploy/install.sh --package ... --init-env                            write the environment template and stop
#
# Order of work (an upgrade stops at the first problem and changes nothing before the migration step):
#   1 verify the archive checksum  2 unpack + verify every file  3 validate the environment  4 backup + verify it (upgrades)
#   5 list pending migrations (dry run)  6 apply migrations  7 switch to the new release  8 restart  9 health verification
#   10 if the new release is not healthy: switch back to the previous release automatically (the database is never reversed).
set -euo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd -P)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

PACKAGE="" DRY_RUN=0 INIT_ENV=0 SKIP_BACKUP=0 EXPECTED_SHA=""
while [ $# -gt 0 ]; do
  case "$1" in
    --package) PACKAGE="${2:?}"; shift 2 ;;
    --sha256) EXPECTED_SHA="${2:?}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --init-env) INIT_ENV=1; shift ;;
    --skip-backup) SKIP_BACKUP=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "unknown option $1" 64 ;;
  esac
done

for tool in tar xz sha256sum curl; do need "$tool"; done
if [ -z "$JM_PREFIX" ] && [ "$(id -u)" != 0 ]; then die "run as root (sudo), or set JM_PREFIX to rehearse in a directory" 64; fi
[ -n "$PACKAGE" ] || die "--package <file> is required" 64
[ -f "$PACKAGE" ] || die "package not found: $PACKAGE" 64

# ---- 1. archive checksum ----------------------------------------------------------------------------------------
actual="$(sha256sum "$PACKAGE" | cut -d' ' -f1)"
if [ -z "$EXPECTED_SHA" ] && [ -f "$PACKAGE.sha256" ]; then EXPECTED_SHA="$(cut -d' ' -f1 < "$PACKAGE.sha256")"; fi
[ -n "$EXPECTED_SHA" ] || die "no checksum: put the .sha256 file next to the package, or pass --sha256 <hash> (obtained over a different channel than the package)" 64
[ "$actual" = "$EXPECTED_SHA" ] || die "ARCHIVE CHECKSUM MISMATCH: the package is damaged or has been modified; do not install it"
log "archive checksum ok ($actual)"

# ---- 2. unpack into a staging directory, verify every file, read the metadata ---------------------------------------------
mkdir -p "$JM_APP_ROOT/releases" "$JM_WEB_ROOT" "$JM_STATE_DIR"
WORK="$(mktemp -d "$JM_APP_ROOT/.unpack.XXXXXX")"
cleanup() { rm -rf "${WORK:?}"; }
trap cleanup EXIT
tar -xJf "$PACKAGE" -C "$WORK" --no-same-owner
SRC="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -n "$SRC" ] && [ -f "$SRC/RELEASE.json" ] && [ -f "$SRC/SHA256SUMS" ] || die "this is not a Jaryan Ma release package"
( cd "$SRC" && sha256sum --check --quiet SHA256SUMS ) || die "FILE CHECKSUM MISMATCH inside the package; do not install it"
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$SRC/RELEASE.json" | head -1)"
[[ "$VERSION" =~ ^[0-9A-Za-z][0-9A-Za-z._-]{0,40}$ ]] || die "cannot read a valid version from RELEASE.json"
log "package ok: version $VERSION ($(find "$SRC" -type f | wc -l) files verified)"

if [ "$INIT_ENV" = 1 ]; then
  mkdir -p "$(dirname "$JM_ENV_FILE")"
  [ -e "$JM_ENV_FILE" ] && die "$JM_ENV_FILE already exists; not overwriting it" 64
  ( umask 027; cp "$SRC/deploy/env/api.env.example" "$JM_ENV_FILE" )
  log "template written to ${JM_ENV_FILE#"$JM_PREFIX"}. Fill in every CHANGE-ME value (generate keys with: openssl rand -base64 32), then run the installer again."
  exit 0
fi

[ -f "$JM_ENV_FILE" ] || die "environment file ${JM_ENV_FILE#"$JM_PREFIX"} not found; create it first with --init-env" 64
if grep -v '^[[:space:]]*#' "$JM_ENV_FILE" | grep -q 'CHANGE-ME'; then die "the environment file still contains CHANGE-ME placeholders" 64; fi

RELEASE_DIR="$JM_APP_ROOT/releases/$VERSION"
NODE="$SRC/runtime/node"; [ -x "$NODE" ] || NODE="$(command -v node || true)"
{ [ -n "$NODE" ] && [ -x "$NODE" ]; } || die "no Node.js available (the package ships its own in runtime/node)"
"$NODE" --version >/dev/null 2>&1 || die "the bundled Node.js does not run on this machine (wrong CPU architecture or libc?)"

# ---- 3. environment validation (the same rules the server applies at start-up) -----------------------------------------------
( load_env "$JM_ENV_FILE"; cd "$SRC/app" && "$NODE" dist/server/cli/ops.mjs config-check ) \
  || die "the environment file is not valid for production (details above); nothing was changed"

# ---- 4/5. database state, backup gate, dry-run of migrations ------------------------------------------------------------------
STATUS_JSON="$( ( load_env "$JM_ENV_FILE"; cd "$SRC/app" && "$NODE" dist/server/cli/migrate.mjs status 2>/dev/null ) || true )"
[ -n "$STATUS_JSON" ] || die "cannot read the database (is PostgreSQL running and DATABASE_URL correct?); nothing was changed"
FRESH=0
if printf '%s' "$STATUS_JSON" | tr -d ' \n' | grep -q '"applied":\[\]'; then FRESH=1; fi
( load_env "$JM_ENV_FILE"; cd "$SRC/app" && "$NODE" dist/server/cli/migrate.mjs deploy --dry-run ) || die "migration pre-check failed; nothing was changed"

if [ "$DRY_RUN" = 1 ]; then log "dry run finished: nothing was changed"; exit 0; fi

if [ "$FRESH" = 0 ] && [ "$SKIP_BACKUP" = 0 ]; then
  log "upgrade: taking and verifying a backup first"
  ( load_env "$JM_ENV_FILE"; cd "$SRC/app" && "$NODE" dist/server/cli/ops.mjs backup && "$NODE" dist/server/cli/ops.mjs backup-verify ) \
    || die "the pre-upgrade backup failed; nothing was changed. Fix the backup (or consciously use --skip-backup) and try again"
elif [ "$FRESH" = 1 ]; then log "fresh database: no backup needed"; else warn "--skip-backup: upgrading WITHOUT a fresh backup"; fi

# ---- 6. place the release, then migrate -----------------------------------------------------------------------------------------
if [ ! -d "$RELEASE_DIR" ]; then
  mkdir -p "$JM_WEB_ROOT/$VERSION"
  cp -a "$SRC/storefront/." "$JM_WEB_ROOT/$VERSION/"
  mv "$SRC" "$RELEASE_DIR"
else
  log "release $VERSION is already unpacked; re-using it"
  if [ ! -d "$JM_WEB_ROOT/$VERSION" ]; then mkdir -p "$JM_WEB_ROOT/$VERSION"; cp -a "$RELEASE_DIR/storefront/." "$JM_WEB_ROOT/$VERSION/"; fi
fi
if [ -z "$JM_PREFIX" ]; then
  id "$JM_SERVICE_USER" >/dev/null 2>&1 || useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin "$JM_SERVICE_USER"
  chown -R root:root "$RELEASE_DIR" "$JM_WEB_ROOT/$VERSION"
  mkdir -p /var/log/jaryan /var/backups/jaryan
  chown "$JM_SERVICE_USER":"$JM_SERVICE_USER" /var/log/jaryan /var/backups/jaryan
  chmod 700 /var/backups/jaryan
  chown root:"$JM_SERVICE_USER" "$JM_ENV_FILE"; chmod 640 "$JM_ENV_FILE"
fi

PREVIOUS="$(current_release || true)"
log "applying database migrations"
NODE_REL="$RELEASE_DIR/runtime/node"; [ -x "$NODE_REL" ] || NODE_REL="$NODE"
( load_env "$JM_ENV_FILE"; cd "$RELEASE_DIR/app" && "$NODE_REL" dist/server/cli/migrate.mjs deploy ) \
  || die "migration failed. The failed migration was rolled back completely and the running release was not touched (details above)"

# ---- 7/8. switch and restart -------------------------------------------------------------------------------------------------------
if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$VERSION" ]; then echo "$PREVIOUS" > "$JM_STATE_DIR/previous"; fi
if [ -z "$JM_PREFIX" ] && [ "$JM_SERVICE_MODE" = systemd ]; then
  install -m 644 "$RELEASE_DIR/deploy/systemd/jaryan-api.service" "/etc/systemd/system/$JM_SERVICE_NAME.service"
  systemctl daemon-reload; systemctl enable "$JM_SERVICE_NAME" >/dev/null 2>&1 || true
fi
point_to_release "$VERSION"
log "switched to release $VERSION; restarting the service"
svc restart || warn "restart command failed"

# ---- 9/10. verify; roll the application back automatically when the new release is not healthy ---------------------------------
if wait_ready && verify_running; then
  record "deploy $VERSION ok (previous: ${PREVIOUS:-none})"
  cleanup_old_releases
  log "DONE: release $VERSION is running and healthy."
  if [ -z "$PREVIOUS" ]; then log "first install: create the owner account with: ${JM_APP_ROOT#"$JM_PREFIX"}/current/bin/jaryan-admin create --email <you> --role owner"; fi
  exit 0
fi

warn "release $VERSION is NOT healthy"
if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$VERSION" ]; then
  warn "rolling the application back to $PREVIOUS (the database keeps the new migrations; read ROLLBACK-FA.md before doing anything to it)"
  point_to_release "$PREVIOUS"; svc restart || true
  if wait_ready; then record "deploy $VERSION FAILED, rolled back to $PREVIOUS"; die "upgrade failed and the previous release $PREVIOUS is running again" 2; fi
  record "deploy $VERSION FAILED, rollback to $PREVIOUS ALSO unhealthy"; die "upgrade failed AND the previous release is not healthy either; manual recovery needed (see ROLLBACK-FA.md)" 3
fi
record "first install of $VERSION FAILED health verification"
die "the first install did not become healthy; check: journalctl -u $JM_SERVICE_NAME -n 100" 2

#!/usr/bin/env bash
# Shared helpers for install.sh / rollback.sh / verify.sh. Sourced, never executed.
# Everything is relative to $JM_PREFIX (default "/"), so the whole flow can be rehearsed in a throw-away directory.

JM_PREFIX="${JM_PREFIX:-}"                         # "" = the real system; a directory = rehearsal
JM_APP_ROOT="${JM_PREFIX}${JM_APP_ROOT:-/opt/jaryan-ma}"
JM_WEB_ROOT="${JM_PREFIX}${JM_WEB_ROOT:-/var/www/jaryan-ma}"
JM_ENV_FILE="${JM_PREFIX}${JM_ENV_FILE:-/etc/jaryan-ma/api.env}"
JM_STATE_DIR="${JM_PREFIX}${JM_STATE_DIR:-/var/lib/jaryan-ma}"
JM_SERVICE_NAME="${JM_SERVICE_NAME:-jaryan-api}"
JM_SERVICE_USER="${JM_SERVICE_USER:-jaryan}"
JM_KEEP_RELEASES="${JM_KEEP_RELEASES:-5}"
JM_HEALTH_TIMEOUT="${JM_HEALTH_TIMEOUT:-60}"      # seconds to wait for the new release to become ready
JM_SERVICE_MODE="${JM_SERVICE_MODE:-systemd}"      # systemd | none (none: a hook script starts/stops the server; used by tests)

log()  { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '[%s] WARNING: %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die()  { printf '[%s] ERROR: %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit "${2:-1}"; }

need() { command -v "$1" >/dev/null 2>&1 || die "required tool not found: $1"; }

# value of KEY in an env file, without sourcing it (the file is data, not code)
env_get() { local f="$1" k="$2"; [ -f "$f" ] || return 0; grep -E "^${k}=" "$f" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

# Loads KEY=VALUE lines into the environment WITHOUT executing the file (it is data, not code; values may contain & $ ` ; quotes).
# Matches how systemd reads EnvironmentFile closely enough for this project's variables; surrounding double quotes are removed.
load_env() {
  local line k v
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    k="${line%%=*}"; v="${line#*=}"
    [[ "$k" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    v="${v%\"}"; v="${v#\"}"
    export "$k=$v"
  done < "$1"
}

port_of_env() { local p; p="$(env_get "$JM_ENV_FILE" PORT)"; echo "${p:-3001}"; }
host_of_env() { local h; h="$(env_get "$JM_ENV_FILE" HOST)"; echo "${h:-127.0.0.1}"; }

# --- service control (systemd or a test double) -------------------------------------------------------------------
svc() {
  local action="$1"
  case "$JM_SERVICE_MODE" in
    systemd) systemctl "$action" "$JM_SERVICE_NAME" ;;
    none)    "${JM_SERVICE_HOOK:?JM_SERVICE_HOOK must be set when JM_SERVICE_MODE=none}" "$action" ;;
    *)       die "unknown JM_SERVICE_MODE $JM_SERVICE_MODE" ;;
  esac
}

# --- health -------------------------------------------------------------------------------------------------------
http_code() { local c; c="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 5 "$1" 2>/dev/null || true)"; echo "${c:-000}"; }

# wait until /readyz answers 200 (database reachable AND all migrations applied), or give up
wait_ready() {
  local base="http://$(host_of_env):$(port_of_env)" waited=0 code=000
  while [ "$waited" -lt "$JM_HEALTH_TIMEOUT" ]; do
    code="$(http_code "$base/readyz")"
    [ "$code" = "200" ] && return 0
    sleep 2; waited=$((waited + 2))
  done
  warn "/readyz still answers $code after ${JM_HEALTH_TIMEOUT}s"
  return 1
}

# deeper checks once ready: liveness, status endpoint, admin PWA shell
verify_running() {
  local base="http://$(host_of_env):$(port_of_env)" ok=0 code path
  for path in /healthz /health /admin/; do
    code="$(http_code "$base$path")"
    if [ "$code" = "200" ]; then log "  ok    $path"; else warn "  FAIL  $path answered $code"; ok=1; fi
  done
  return "$ok"
}

# --- releases -----------------------------------------------------------------------------------------------------
current_release() { local t; t="$(readlink "$JM_APP_ROOT/current" 2>/dev/null || true)"; [ -n "$t" ] && basename "$t" || true; }
previous_release() { if [ -f "$JM_STATE_DIR/previous" ]; then cat "$JM_STATE_DIR/previous"; fi; }

# atomic switch of a symlink (rename over the old one)
switch_link() { local link="$1" target="$2"; ln -sfn "$target" "$link.new" && mv -T "$link.new" "$link"; }

point_to_release() {
  local version="${1:?version}"
  [ -d "$JM_APP_ROOT/releases/$version" ] || die "release $version is not installed"
  switch_link "$JM_APP_ROOT/current" "releases/$version"
  if [ -d "$JM_WEB_ROOT/$version" ]; then switch_link "$JM_WEB_ROOT/current" "$version"; fi
  return 0
}

record() { mkdir -p "$JM_STATE_DIR"; printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$JM_STATE_DIR/history.log"; }

cleanup_old_releases() {
  local keep="$JM_KEEP_RELEASES" cur prev v
  cur="$(current_release)"; prev="$(previous_release)"
  # newest first by modification time; never remove the current or the previous release
  for v in $(ls -1t "$JM_APP_ROOT/releases" 2>/dev/null | tail -n +"$((keep + 1))"); do
    if [ "$v" != "$cur" ] && [ "$v" != "$prev" ]; then
      log "removing old release $v"
      rm -rf "${JM_APP_ROOT:?}/releases/${v:?}" "${JM_WEB_ROOT:?}/${v:?}"
    fi
  done
}

# --- schema compatibility ---------------------------------------------------------------------------------------
# How does the CURRENT database relate to the migration files of a given release? Read-only (uses `migrate check` of that release).
#   schema_check <release dir>   sets SCHEMA_STATE and SCHEMA_DETAIL (migration names only), returns:
#     0  compatible      every migration of the release is applied and the database has nothing the release does not know
#     65 newer_unknown   the database has applied migrations the release does not contain. NOT proof of incompatibility,
#                        but compatibility cannot be established from here, so anything automatic must stop
#     66 failed          an unfinished migration, or an applied migration whose file differs
#     67 missing         the release has migrations that are not applied yet
#     68 undetermined    the database could not be read (so compatibility is unknown: treated like "not compatible")
SCHEMA_STATE="" SCHEMA_DETAIL=""
schema_check() {
  local rel="${1:?release dir}" node out code
  node="$rel/runtime/node"; [ -x "$node" ] || node="$(command -v node || true)"
  SCHEMA_STATE="undetermined"; SCHEMA_DETAIL=""
  [ -n "$node" ] && [ -f "$rel/app/dist/server/cli/migrate.mjs" ] || return 68
  out="$( ( load_env "$JM_ENV_FILE"; cd "$rel/app" && "$node" dist/server/cli/migrate.mjs check ) 2>/dev/null )"; code=$?
  SCHEMA_DETAIL="$(printf '%s' "$out" | tr -d '\n')"
  case "$code" in
    0)  SCHEMA_STATE="compatible"; return 0 ;;
    65) SCHEMA_STATE="newer_unknown"; return 65 ;;
    66) SCHEMA_STATE="failed"; return 66 ;;
    67) SCHEMA_STATE="missing"; return 67 ;;
    *)  SCHEMA_STATE="undetermined"; return 68 ;;
  esac
}

# Plain-language explanation for a non-compatible state (used by rollback.sh, install.sh and verify.sh)
schema_explain() {
  case "$1" in
    newer_unknown) echo "the database has applied migrations that this release does not contain: $SCHEMA_DETAIL. That does not prove the release is incompatible (an additive change may be harmless), but it cannot be established automatically." ;;
    failed)        echo "a migration is unfinished or an applied migration differs from this release's file: $SCHEMA_DETAIL" ;;
    missing)       echo "this release contains migrations that are not applied to the database yet: $SCHEMA_DETAIL" ;;
    *)             echo "the database could not be read, so compatibility is unknown" ;;
  esac
}

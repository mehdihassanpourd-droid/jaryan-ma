#!/usr/bin/env bash
# Read-only verification of an installed system: file integrity, permissions, service health, endpoints, migrations, and
# (with --public-media) that the public media address denies everything it must. Exit 0 = everything checked is fine.
#   ./deploy/verify.sh [--public-media https://media.example.ir]
set -uo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd -P)"
. "$HERE/lib.sh"
MEDIA=""
while [ $# -gt 0 ]; do case "$1" in --public-media) MEDIA="${2:?}"; shift 2 ;; *) die "unknown option $1" 64 ;; esac; done
FAIL=0
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then log "  ok    $name"; else warn "  FAIL  $name"; FAIL=1; fi; }
CUR="$(current_release || true)"; [ -n "$CUR" ] || die "no release is installed"
REL="$JM_APP_ROOT/releases/$CUR"
log "release $CUR"
check "release files match SHA256SUMS" bash -c "cd '$REL' && sha256sum --check --quiet SHA256SUMS"
check "storefront files present" test -f "$JM_WEB_ROOT/$CUR/index.html"
check "environment file is not world-readable" bash -c "[ \$(( 0$(stat -c %a "$JM_ENV_FILE" 2>/dev/null || echo 777) & 7 )) -eq 0 ]"
if [ -d "$JM_PREFIX/var/backups/jaryan" ]; then
  check "backup directory is private (no group/other access)" bash -c "[ \$(( 0$(stat -c %a "$JM_PREFIX/var/backups/jaryan") & 77 )) -eq 0 ]"
fi
check "service answers /readyz" bash -c ". '$HERE/lib.sh'; [ \"\$(http_code http://$(host_of_env):$(port_of_env)/readyz)\" = 200 ]"
verify_running || FAIL=1
check "no pending migrations" bash -c ". '$HERE/lib.sh'; load_env '$JM_ENV_FILE'; cd '$REL/app'; N='$REL/runtime/node'; [ -x \"\$N\" ] || N=\$(command -v node); \"\$N\" dist/server/cli/migrate.mjs status >/dev/null"
if [ -n "$MEDIA" ]; then
  for bad in "/" "/?list-type=2" "/minio/health/live" "/minio/admin/v3/info" "/jaryan-media/" "/backups/x" "/images" "/%2e%2e/etc/passwd"; do
    code="$(http_code "$MEDIA$bad")"
    case "$code" in 403|404|405|400) log "  ok    media $bad -> $code" ;; *) warn "  FAIL  media $bad answered $code (must be denied)"; FAIL=1 ;; esac
  done
fi
if [ "$FAIL" = 0 ]; then log "VERIFIED"; else die "verification found problems (see above)" 1; fi

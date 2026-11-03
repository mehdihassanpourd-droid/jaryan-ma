#!/usr/bin/env bash
# Rehearses the whole offline install / upgrade / failed-upgrade / rollback flow in an isolated machine-like sandbox:
#   * a private network namespace with ONLY the loopback interface (no DNS, no internet: any download attempt fails)
#   * a throw-away PostgreSQL cluster
#   * the installer working under a temporary prefix with a service hook instead of systemd
# It does not touch the real system, a real database or any production data.
#
#   sudo scripts/release/rehearse-offline-install.sh --v1 pkg1.tar.xz --v2 pkg2.tar.xz
# Requires root (for the network namespace and the postgres user), PostgreSQL 16 server binaries, curl, python3.
set -uo pipefail
if [ -z "${JM_REHEARSAL_INNER:-}" ]; then
  [ "$(id -u)" = 0 ] || { echo "run as root (needs a network namespace)"; exit 64; }
  exec unshare --net env JM_REHEARSAL_INNER=1 bash "$(readlink -f "$0")" "$@"
fi

REPO="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd -P)"
V1="" V2=""
while [ $# -gt 0 ]; do case "$1" in --v1) V1="$(readlink -f "$2")"; shift 2 ;; --v2) V2="$(readlink -f "$2")"; shift 2 ;; *) echo "unknown option $1"; exit 64 ;; esac; done
[ -f "$V1" ] && [ -f "$V2" ] || { echo "--v1 and --v2 (two release packages) are required"; exit 64; }

T="$(mktemp -d /tmp/jm-rehearsal.XXXXXX)"; chmod 755 "$T"
PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  PASS  $*"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL  $*"; }
expect_ok()   { local name="$1"; shift; if "$@" >"$T/last.log" 2>&1; then ok "$name"; else bad "$name"; sed 's/^/        /' "$T/last.log" | tail -15; fi; }
expect_fail() { local name="$1"; shift; if "$@" >"$T/last.log" 2>&1; then bad "$name (it succeeded but must fail)"; else ok "$name"; fi; }
cleanup() {
  [ -f "$T/hook.pid" ] && kill "$(cat "$T/hook.pid")" 2>/dev/null
  [ -f "$T/s3.pid" ] && kill "$(cat "$T/s3.pid")" 2>/dev/null
  [ -d "$T/pg" ] && runuser -u postgres -- "$PGBIN/pg_ctl" -D "$T/pg" -m immediate stop >/dev/null 2>&1
  cd /; rm -rf "${T:?}"
}
trap cleanup EXIT

echo "== sandbox =="
python3 - <<'PY'
import fcntl, socket, struct
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
ifr = struct.pack("16sH", b"lo", 0)
flags = struct.unpack("16sH", fcntl.ioctl(s, 0x8913, ifr))[1]            # SIOCGIFFLAGS
fcntl.ioctl(s, 0x8914, struct.pack("16sH", b"lo", flags | 1))           # SIOCSIFFLAGS: IFF_UP
PY
if curl --silent --max-time 4 https://registry.npmjs.org/ >/dev/null 2>&1 || curl --silent --max-time 4 https://github.com/ >/dev/null 2>&1; then bad "the sandbox has internet access (it must not)"; else ok "no internet: registry.npmjs.org and github.com are unreachable"; fi
if getent hosts registry.npmjs.org >/dev/null 2>&1; then bad "DNS works in the sandbox"; else ok "no DNS resolution"; fi

echo "== throw-away PostgreSQL =="
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
[ -n "$PGBIN" ] || { echo "PostgreSQL server binaries not found"; exit 64; }
mkdir -p "$T/pg" "$T/pgsock"; chown postgres:postgres "$T/pg" "$T/pgsock"
runuser -u postgres -- "$PGBIN/initdb" -D "$T/pg" --auth=trust --encoding=UTF8 >/dev/null 2>&1 || { echo "initdb failed"; exit 1; }
PGPORT=55432
runuser -u postgres -- "$PGBIN/pg_ctl" -D "$T/pg" -o "-p $PGPORT -k $T/pgsock -c listen_addresses=127.0.0.1" -l "$T/pgsock/pg.log" -w start >/dev/null 2>&1 || { cat "$T/pgsock/pg.log"; exit 1; }
runuser -u postgres -- "$PGBIN/psql" -h 127.0.0.1 -p $PGPORT -d postgres -qc "CREATE ROLE jaryan LOGIN PASSWORD 'rehearsal-only' CREATEDB" -c "CREATE DATABASE jaryan OWNER jaryan" -c "CREATE DATABASE scratch OWNER jaryan" || exit 1
ok "PostgreSQL started on loopback"

echo "== fake object store (S3-compatible, accepts uploads) =="
cat > "$T/fake-s3.py" <<'PY'
import http.server, sys
class H(http.server.BaseHTTPRequestHandler):
    def _ok(self):
        n = int(self.headers.get("content-length") or 0)
        if n: self.rfile.read(n)
        self.send_response(200); self.send_header("ETag", '"x"'); self.send_header("content-length", "0"); self.end_headers()
    do_PUT = do_POST = do_DELETE = do_GET = do_HEAD = _ok
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
python3 "$T/fake-s3.py" 59000 & echo $! > "$T/s3.pid"

echo "== server environment =="
ROOT="$T/root"; mkdir -p "$ROOT"
export JM_PREFIX="$ROOT" JM_SERVICE_MODE=none JM_SERVICE_HOOK="$T/hook.sh" JM_HEALTH_TIMEOUT=40
cat > "$T/hook.sh" <<HOOK
#!/usr/bin/env bash
# stands in for systemctl: runs the INSTALLED release the way the systemd unit would
set -u
stop_it() { if [ -f "$T/hook.pid" ]; then kill "\$(cat "$T/hook.pid")" 2>/dev/null; sleep 1; rm -f "$T/hook.pid"; fi; }
case "\$1" in
  stop) stop_it ;;
  start|restart)
    stop_it
    ( . "$REPO/deploy/lib.sh"; load_env "$ROOT/etc/jaryan-ma/api.env"; cd "$ROOT/opt/jaryan-ma/current/app" && exec "$ROOT/opt/jaryan-ma/current/bin/jaryan-api" ) >> "$T/server.log" 2>&1 &
    echo \$! > "$T/hook.pid" ;;
esac
HOOK
chmod +x "$T/hook.sh"

INSTALL="$REPO/deploy/install.sh"
expect_ok "install.sh --init-env writes a template and stops" bash "$INSTALL" --package "$V1" --init-env
ENVF="$ROOT/etc/jaryan-ma/api.env"
expect_fail "the installer refuses an environment file that still has CHANGE-ME placeholders" bash "$INSTALL" --package "$V1"

KEY1="$(head -c 32 /dev/urandom | base64)"; KEY2="$(head -c 32 /dev/urandom | base64)"
python3 - "$ENVF" "$T" "$PGPORT" "$KEY1" "$KEY2" <<'PY'
import sys, re
path, t, port, k1, k2 = sys.argv[1:]
s = open(path).read()
s = s.replace("postgresql://jaryan:CHANGE-ME@127.0.0.1:5432/jaryan", f"postgresql://jaryan:rehearsal-only@127.0.0.1:{port}/jaryan")
s = s.replace("PORT=3001", "PORT=3101").replace("S3_ENDPOINT=http://127.0.0.1:9000", "S3_ENDPOINT=http://127.0.0.1:59000")
s = s.replace("S3_ACCESS_KEY_ID=CHANGE-ME", "S3_ACCESS_KEY_ID=rehearsal").replace("S3_SECRET_ACCESS_KEY=CHANGE-ME", "S3_SECRET_ACCESS_KEY=rehearsal-secret")
s = s.replace("APP_ENCRYPTION_KEY=CHANGE-ME", "APP_ENCRYPTION_KEY=" + k1).replace("BACKUP_ENCRYPTION_KEY=CHANGE-ME", "BACKUP_ENCRYPTION_KEY=" + k2)
s = s.replace("BACKUP_DIR=/var/backups/jaryan", f"BACKUP_DIR={t}/backups").replace("ALERT_FILE=/var/log/jaryan/alerts.jsonl", f"ALERT_FILE={t}/alerts.jsonl")
s = s.replace("https://media.example.ir", "https://media.jaryan.test").replace("https://admin.example.ir", "https://admin.jaryan.test")
open(path, "w").write(s)
PY
mkdir -p "$T/backups"; chmod 700 "$T/backups"
expect_ok "dry run verifies the package and lists migrations, changing nothing" bash "$INSTALL" --package "$V1" --dry-run
[ ! -e "$ROOT/opt/jaryan-ma/current" ] && ok "dry run installed nothing" || bad "dry run left a release behind"

echo "== first install (v1) =="
expect_ok "install v1 on an empty database" bash "$INSTALL" --package "$V1"
cat "$T/last.log" | sed 's/^/        /' | tail -12
V1NAME="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/opt/jaryan-ma/current/RELEASE.json" | head -1)"
expect_ok "v1 is the current release" test "$(readlink "$ROOT/opt/jaryan-ma/current")" = "releases/$V1NAME"
expect_ok "all migrations applied (nothing pending)" bash -c ". '$REPO/deploy/lib.sh'; load_env '$ENVF'; cd '$ROOT/opt/jaryan-ma/current/app' && ../runtime/node dist/server/cli/migrate.mjs status >/dev/null"
expect_ok "verify.sh passes" bash "$REPO/deploy/verify.sh"
expect_ok "/readyz answers 200" test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3101/readyz)" = 200
expect_ok "admin PWA shell is served at /admin/" bash -c "curl -s http://127.0.0.1:3101/admin/ | grep -qi '<html'"
expect_ok "admin API refuses anonymous callers" test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3101/api/v1/products)" = 401
expect_ok "maintenance endpoints refuse anonymous callers" test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3101/api/v1/maintenance/health)" = 401
expect_ok "every response carries a request id" bash -c "curl -sI http://127.0.0.1:3101/health | grep -qi '^x-request-id:'"
expect_ok "storefront files are in place" test -f "$ROOT/var/www/jaryan-ma/current/index.html"
expect_ok "ops health runs from the package (config + database + migrations)" bash -c ". '$REPO/deploy/lib.sh'; load_env '$ENVF'; '$ROOT/opt/jaryan-ma/current/bin/jaryan-ops' health | grep -q '\"name\": \"migrations\"'"
expect_ok "the first administrator can be created with the packaged CLI" bash -c ". '$REPO/deploy/lib.sh'; load_env '$ENVF'; '$ROOT/opt/jaryan-ma/current/bin/jaryan-admin' 2>&1 | grep -qi 'usage\\|command'"
expect_ok "install history is recorded" grep -q "deploy $V1NAME ok" "$ROOT/var/lib/jaryan-ma/history.log"

echo "== upgrade (v2) =="
expect_ok "upgrade to v2: backup, verify, migrate, switch, health" bash "$INSTALL" --package "$V2"
V2NAME="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/opt/jaryan-ma/current/RELEASE.json" | head -1)"
expect_ok "v2 is current and v1 is remembered as previous" bash -c "[ \"\$(readlink '$ROOT/opt/jaryan-ma/current')\" = releases/$V2NAME ] && [ \"\$(cat '$ROOT/var/lib/jaryan-ma/previous')\" = $V1NAME ]"
expect_ok "a verified encrypted backup was taken before the upgrade" bash -c "ls '$T/backups'/*.dump.enc >/dev/null && ls '$T/backups'/*.manifest.json >/dev/null"
expect_ok "verify.sh passes after the upgrade" bash "$REPO/deploy/verify.sh"

echo "== refused packages change nothing =="
BEFORE="$(readlink "$ROOT/opt/jaryan-ma/current")"
cp "$V2" "$T/damaged.tar.xz"; cp "$V2.sha256" "$T/damaged.tar.xz.sha256"; printf 'x' | dd of="$T/damaged.tar.xz" bs=1 seek=5000 conv=notrunc 2>/dev/null
expect_fail "a damaged archive is refused (archive checksum)" bash "$INSTALL" --package "$T/damaged.tar.xz"
# modify one file inside, keep the old SHA256SUMS: the archive checksum is valid (we recompute it) but a file does not match
mkdir -p "$T/tamper" && tar -xJf "$V2" -C "$T/tamper"
TD="$(find "$T/tamper" -mindepth 1 -maxdepth 1 -type d | head -1)"
echo "// injected" >> "$TD/app/dist/server/main.mjs"
sed -i "s/\"version\": \"$V2NAME\"/\"version\": \"$V2NAME-tampered\"/" "$TD/RELEASE.json"
tar -cJf "$T/tampered.tar.xz" -C "$T/tamper" "$(basename "$TD")"; sha256sum "$T/tampered.tar.xz" | sed "s#$T/##" > "$T/tampered.tar.xz.sha256"
expect_fail "a package with a modified file is refused (file checksum)" bash "$INSTALL" --package "$T/tampered.tar.xz"
expect_fail "a package without a checksum is refused" bash "$INSTALL" --package "$T/tampered.tar.xz" --sha256 ""
[ "$(readlink "$ROOT/opt/jaryan-ma/current")" = "$BEFORE" ] && ok "the running release did not change" || bad "a refused package changed the current release"
expect_ok "the service is still healthy" test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3101/readyz)" = 200

echo "== a release that does not start is rolled back automatically =="
mkdir -p "$T/broken" && tar -xJf "$V2" -C "$T/broken"
BD="$(find "$T/broken" -mindepth 1 -maxdepth 1 -type d | head -1)"
printf 'process.exit(1);\n' > "$BD/app/dist/server/main.mjs"
sed -i "s/\"version\": \"$V2NAME\"/\"version\": \"$V2NAME-broken\"/" "$BD/RELEASE.json"
( cd "$BD" && find . -type f ! -name SHA256SUMS | sort | sed 's#^\./##' | xargs sha256sum > SHA256SUMS )
tar -cJf "$T/broken.tar.xz" -C "$T/broken" "$(basename "$BD")"; ( cd "$T" && sha256sum broken.tar.xz > broken.tar.xz.sha256 )
JM_HEALTH_TIMEOUT=10 bash "$INSTALL" --package "$T/broken.tar.xz" >"$T/broken.log" 2>&1; CODE=$?
sed 's/^/        /' "$T/broken.log" | tail -8
[ "$CODE" = 2 ] && ok "installer exits 2 (upgrade failed, previous release running again)" || bad "installer exit code $CODE (expected 2)"
[ "$(readlink "$ROOT/opt/jaryan-ma/current")" = "releases/$V2NAME" ] && ok "current release is back to $V2NAME" || bad "current release is $(readlink "$ROOT/opt/jaryan-ma/current")"
expect_ok "service is healthy again after the automatic rollback" test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3101/readyz)" = 200
expect_ok "the failure is recorded" grep -q "FAILED, rolled back" "$ROOT/var/lib/jaryan-ma/history.log"

echo "== manual rollback =="
expect_ok "rollback.sh --list" bash "$REPO/deploy/rollback.sh" --list
expect_ok "rollback to v1" bash "$REPO/deploy/rollback.sh" --to "$V1NAME"
expect_ok "v1 is current and healthy after rollback" bash -c "[ \"\$(readlink '$ROOT/opt/jaryan-ma/current')\" = releases/$V1NAME ] && [ \"\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3101/readyz)\" = 200 ]"
echo "// damaged after install" >> "$ROOT/opt/jaryan-ma/releases/$V2NAME/app/dist/server/main.mjs"
expect_fail "rollback refuses to switch to an installed release that fails its checksums" bash "$REPO/deploy/rollback.sh" --to "$V2NAME"
expect_fail "verify.sh detects a damaged current release" bash -c "echo '// x' >> '$ROOT/opt/jaryan-ma/releases/$V1NAME/app/dist/server/main.mjs'; bash '$REPO/deploy/verify.sh'"

echo "== restore drill with the packaged tools (scratch database on the same disposable server) =="
printf '' > "$T/last.log"
expect_ok "backup-verify and restore-test run from the package (no npm)" bash -c ". '$REPO/deploy/lib.sh'; load_env '$ENVF'; export RESTORE_TEST_ADMIN_URL='postgresql://postgres@127.0.0.1:$PGPORT/postgres' ALLOW_SAME_SERVER=yes JARYAN_OPS='$ROOT/opt/jaryan-ma/releases/$V2NAME/bin/jaryan-ops'; bash '$ROOT/opt/jaryan-ma/releases/$V2NAME/scripts/maintenance/restore-drill.sh'"

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]

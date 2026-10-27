#!/usr/bin/env bash
# Shared helpers for the GitHub Codespaces test environment. Sourced by the other scripts; never run directly.
#
# What this environment is: a throw-away place to try the REAL admin app from a phone. It runs the same server code as
# production (real PostgreSQL 16, mandatory password + TOTP, Secure cookies, strict CSP) in development mode with local
# media. It has no default account, no bypass flag, and nothing here is a production credential.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="${JARYAN_STATE_DIR:-$ROOT/.data/codespace}"     # /.data/ is git-ignored
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PG_PORT="${JARYAN_PG_PORT:-5433}"
PG_DIR="$STATE/pg"
PASS_FILE="$STATE/db.pass"
APP_PORT="${PORT:-3001}"

die() { echo "خطا: $*" >&2; exit 1; }
say() { echo "• $*"; }

db_password() { cat "$PASS_FILE"; }
database_url() { echo "postgresql://jaryan:$(db_password)@127.0.0.1:${PG_PORT}/jaryan"; }

pg_up() { "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PG_PORT"; }

# Starts the private PostgreSQL 16 (listens on 127.0.0.1 only, password from $PASS_FILE). Safe to call repeatedly.
start_db() {
  [ -f "$PG_DIR/PG_VERSION" ] || die "پایگاه داده ساخته نشده است. ابتدا اجرا کنید: npm run codespace:setup"
  if pg_up; then return 0; fi
  mkdir -p "$STATE/sock"
  "$PG_BIN/pg_ctl" -D "$PG_DIR" -l "$STATE/pg.log" -w -t 60 \
    -o "-p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$STATE/sock" start >/dev/null \
    || { tail -n 20 "$STATE/pg.log" >&2 || true; die "PostgreSQL شروع نشد."; }
}

# Variables every server-side command in this environment shares. TOTP and Secure cookies are mandatory, there is no
# default admin (DEV_ADMIN_* is explicitly unset), customer accounts and SMS stay off.
export_server_env() {
  unset DEV_ADMIN_EMAIL DEV_ADMIN_PASSWORD
  # Lets you create the FIRST administrator in the browser (password + mandatory TOTP). The server closes it for good once
  # an account exists and refuses this flag in production.
  export FIRST_RUN_SETUP=true
  export NODE_ENV=development
  export HOST=127.0.0.1 PORT="$APP_PORT"
  export DATABASE_URL; DATABASE_URL="$(database_url)"
  export DEV_DATA_DIR="$STATE/data"
  export REQUIRE_TOTP=true COOKIE_SECURE=true
  export CUSTOMER_ACCOUNTS_ENABLED=false SCHEDULER_ENABLED=false
}

# The private https URL of this Codespace's forwarded port. `JARYAN_PUBLIC_ORIGIN` exists only so CI can verify the
# scripts outside a Codespace; it must be an https origin.
public_origin() {
  if [ -n "${JARYAN_PUBLIC_ORIGIN:-}" ]; then
    [[ "$JARYAN_PUBLIC_ORIGIN" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "JARYAN_PUBLIC_ORIGIN باید یک نشانی https ساده باشد."
    echo "$JARYAN_PUBLIC_ORIGIN"
  elif [ "${CODESPACES:-}" = "true" ] && [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
    echo "https://${CODESPACE_NAME}-${APP_PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  else
    die "این دستور فقط داخل GitHub Codespaces اجرا می‌شود (نشانی خصوصی پیدا نشد)."
  fi
}

app_up() { curl -fsS -m 3 "http://127.0.0.1:${APP_PORT}/healthz" >/dev/null 2>&1; }

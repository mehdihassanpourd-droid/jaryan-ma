#!/usr/bin/env bash
# One-time (idempotent) preparation: PostgreSQL 16, dependencies, database schema, admin app build.
# Runs automatically when the Codespace is created; safe to run again.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

umask 077
mkdir -p "$STATE"
chmod 700 "$STATE"
cd "$ROOT"

if [ ! -x "$PG_BIN/initdb" ]; then
  say "نصب PostgreSQL 16 (از مخزن رسمی Ubuntu)…"
  sudo apt-get update -qq
  sudo apt-get install -y -qq postgresql-common
  # No system cluster/service: we run our own private instance below, as the current user.
  echo 'create_main_cluster = false' | sudo tee /etc/postgresql-common/createcluster.conf >/dev/null
  sudo apt-get install -y -qq postgresql-16 postgresql-client-16
fi

if [ ! -f "$PG_DIR/PG_VERSION" ]; then
  say "ساخت پایگاه داده خصوصی (فقط روی 127.0.0.1، گذرواژهٔ تصادفی)…"
  openssl rand -hex 24 > "$PASS_FILE"
  chmod 600 "$PASS_FILE"
  "$PG_BIN/initdb" -D "$PG_DIR" -U jaryan -E UTF8 --locale=C.UTF-8 \
    --auth-local=scram-sha-256 --auth-host=scram-sha-256 --pwfile="$PASS_FILE" >/dev/null
fi

start_db
if [ "$(PGPASSWORD="$(db_password)" "$PG_BIN/psql" -h 127.0.0.1 -p "$PG_PORT" -U jaryan -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='jaryan'")" != "1" ]; then
  PGPASSWORD="$(db_password)" "$PG_BIN/createdb" -h 127.0.0.1 -p "$PG_PORT" -U jaryan jaryan
fi

if [ "${JARYAN_SKIP_NPM:-}" != "1" ]; then   # the skip switch exists only so CI/local checks can reuse an installed tree
  say "نصب وابستگی‌ها…"
  npm ci --no-audit --no-fund
  npm run --silent db:generate
fi

say "اعمال migrationها (همان فرمان محیط واقعی)…"
DATABASE_URL="$(database_url)" npx prisma migrate deploy

if [ "${JARYAN_SKIP_NPM:-}" != "1" ]; then
  say "ساخت برنامهٔ مدیریت…"
  npm run --silent admin:build
fi

say "آماده است. مرحلهٔ بعد: npm run codespace:admin -- you@example.com"

#!/usr/bin/env bash
# Creates a real administrator (password + TOTP) in this Codespace's private database.
#   npm run codespace:admin -- you@example.com [owner|editor|viewer]
# The password is typed at a hidden prompt (never an argument); the TOTP secret is printed once so you can enter it in
# your authenticator app ("Enter a setup key"), then you confirm with a 6-digit code.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

email="${1:-}"
role="${2:-owner}"
[ -n "$email" ] || die "ایمیل را بدهید: npm run codespace:admin -- you@example.com"
case "$role" in owner|editor|viewer) ;; *) die "نقش باید owner، editor یا viewer باشد." ;; esac

start_db
export_server_env
cd "$ROOT"
exec npx tsx server/cli/admin.ts create --email "$email" --role "$role"

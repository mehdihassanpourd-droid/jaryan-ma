#!/usr/bin/env bash
# Checks a RUNNING probe from outside, from the same machine or from any computer with curl:
#   scripts/self-check.sh --domain example.ir [--port 443] [--insecure] [--ip 127.0.0.1]
# --insecure  accept a self-signed certificate (tests only; a real trial must run WITHOUT it, because valid HTTPS is part of the test)
# --ip        send the three host names to this address (for a test before DNS exists)
# Exit code 0 = every check passed.
set -uo pipefail
DOMAIN="" PORT=443 INSECURE="" IP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?}"; shift 2 ;;
    --port) PORT="${2:?}"; shift 2 ;;
    --insecure) INSECURE="-k"; shift ;;
    --ip) IP="${2:?}"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 64 ;;
  esac
done
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || { echo "usage: $0 --domain example.ir [--port 443] [--insecure] [--ip A.B.C.D]" >&2; exit 64; }
PAGE="probe.$DOMAIN" API="probe-api.$DOMAIN" PAY="probe-pay.$DOMAIN"
SUFFIX=""; [ "$PORT" != "443" ] && SUFFIX=":$PORT"
RESOLVE=()
[ -n "$IP" ] && RESOLVE=(--resolve "$PAGE:$PORT:$IP" --resolve "$API:$PORT:$IP" --resolve "$PAY:$PORT:$IP")
fail=0
c() { curl -sS --max-time 15 $INSECURE "${RESOLVE[@]}" "$@"; }
ok() { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; fail=1; }
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then ok "$name"; else bad "$name"; fi; }

H="$(c -D - -o /dev/null "https://$PAGE$SUFFIX/")" ; echo "$H" | head -1 | grep -q " 200" && ok "page over HTTPS (certificate valid for $PAGE)" || bad "page over HTTPS (certificate valid for $PAGE)"
echo "$H" | grep -qi '^strict-transport-security' && ok "HSTS header" || bad "HSTS header"
echo "$H" | grep -qi '^server: .*[0-9]' && bad "server version is hidden" || ok "server version is hidden"
check "API host certificate valid" c -o /dev/null "https://$API$SUFFIX/api/ping"
check "payment host certificate valid" c -o /dev/null -w '%{http_code}' "https://$PAY$SUFFIX/gateway"
SIZE="$(c -o /dev/null -w '%{size_download}' "https://$PAGE$SUFFIX/img/product.png")"; [ "${SIZE:-0}" -gt 250000 ] && ok "product image ($SIZE bytes)" || bad "product image ($SIZE bytes)"
SIZE="$(c -o /dev/null -w '%{size_download}' "https://$PAGE$SUFFIX/data/catalog.json")"; [ "${SIZE:-0}" -gt 80000 ] && ok "catalogue ($SIZE bytes)" || bad "catalogue ($SIZE bytes)"
ORIGIN="https://$PAGE$SUFFIX"
c -D - -o /dev/null -H "Origin: $ORIGIN" "https://$API$SUFFIX/api/ping" | tr -d '\r' | grep -qix "access-control-allow-origin: $ORIGIN" && ok "CORS allows the storefront origin" || bad "CORS allows the storefront origin"
c -D - -o /dev/null -H "Origin: https://evil.example" "https://$API$SUFFIX/api/ping" | tr -d '\r' | grep -qi "access-control-allow-origin: https://evil" && bad "CORS does not reflect another origin" || ok "CORS does not reflect another origin"
COOKIE="$(c -D - -o /dev/null -X POST "https://$API$SUFFIX/api/login" | tr -d '\r' | grep -i '^set-cookie:')"
echo "$COOKIE" | grep -qi 'secure' && echo "$COOKIE" | grep -qi 'httponly' && echo "$COOKIE" | grep -qi 'samesite=lax' && ok "session cookie is Secure, HttpOnly, SameSite" || bad "session cookie is Secure, HttpOnly, SameSite"
LOC="$(c -D - -o /dev/null "https://$PAGE$SUFFIX/pay/start" | tr -d '\r' | grep -i '^location:')"
echo "$LOC" | grep -qi "$PAY" && ok "payment redirect goes to the gateway host" || bad "payment redirect goes to the gateway host"
LOC="$(c -D - -o /dev/null "https://$PAY$SUFFIX/gateway" | tr -d '\r' | grep -i '^location:')"
echo "$LOC" | grep -qi "https://$PAGE" && ok "gateway sends the browser back" || bad "gateway sends the browser back"
[ "$PORT" = 443 ] && { [ "$(c -o /dev/null -w '%{http_code}' "http://$PAGE/")" = 301 ] && ok "http redirects to https" || bad "http redirects to https"; }
BODY="$(head -c 1200000 /dev/zero | tr '\0' 'a')"
CODE="$(printf '%s' "$BODY" | c -o /dev/null -w '%{http_code}' -X POST --data-binary @- -H 'Content-Type: application/json' "https://$API$SUFFIX/api/order")"
[ "$CODE" = 413 ] && ok "oversized body is refused (413)" || bad "oversized body is refused (got $CODE)"
c --tls-max 1.1 -o /dev/null "https://$PAGE$SUFFIX/" >/dev/null 2>&1 && bad "old TLS (1.1) is refused" || ok "old TLS (1.1) is refused"
echo
[ "$fail" = 0 ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit "$fail"

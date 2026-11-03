#!/usr/bin/env bash
# Renders nginx/probe.conf.template into a ready nginx configuration file.
#
#   scripts/render.sh --domain example.ir --cert-dir /etc/letsencrypt/live/probe.example.ir \
#       [--web-root /var/www/jm-probe/web] [--log-dir /var/log/nginx] [--acme-root /var/www/jm-probe/acme] \
#       [--http-port 80] [--https-port 443] [--ipv6] [--out /etc/nginx/conf.d/jm-probe.conf]
#
# --domain      your domain WITHOUT the probe. prefix; the three host names are probe.D, probe-api.D and probe-pay.D
# --cert-dir    directory holding fullchain.pem and privkey.pem (one certificate that covers all three names)
# Without --out the result is printed. The script changes nothing else on the machine.
set -euo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd -P)"
DOMAIN="" CERT_DIR="" WEB_ROOT="/var/www/jm-probe/web" LOG_DIR="/var/log/nginx" ACME_ROOT="/var/www/jm-probe/acme" HTTP_PORT=80 HTTPS_PORT=443 IPV6=0 OUT=""
die() { echo "ERROR: $*" >&2; exit 64; }
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?}"; shift 2 ;;
    --cert-dir) CERT_DIR="${2:?}"; shift 2 ;;
    --web-root) WEB_ROOT="${2:?}"; shift 2 ;;
    --log-dir) LOG_DIR="${2:?}"; shift 2 ;;
    --acme-root) ACME_ROOT="${2:?}"; shift 2 ;;
    --http-port) HTTP_PORT="${2:?}"; shift 2 ;;
    --https-port) HTTPS_PORT="${2:?}"; shift 2 ;;
    --ipv6) IPV6=1; shift ;;
    --out) OUT="${2:?}"; shift 2 ;;
    *) die "unknown option $1" ;;
  esac
done
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "--domain must be a plain domain name (letters, digits, dots, hyphens)"
[ -n "$CERT_DIR" ] || die "--cert-dir is required"
for path in "$CERT_DIR" "$WEB_ROOT" "$LOG_DIR" "$ACME_ROOT"; do [[ "$path" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "paths must be absolute and contain only letters, digits and . _ - /"; done
[[ "$HTTP_PORT" =~ ^[0-9]{1,5}$ && "$HTTPS_PORT" =~ ^[0-9]{1,5}$ ]] || die "ports must be numbers"
suffix=""; [ "$HTTPS_PORT" = 443 ] || suffix=":$HTTPS_PORT"
l6() { if [ "$IPV6" = 1 ]; then printf 'listen [::]:%s%s;' "$1" "$2"; fi; }
sed -e "s#@DOMAIN@#$DOMAIN#g" -e "s#@CERT_DIR@#$CERT_DIR#g" -e "s#@WEB_ROOT@#$WEB_ROOT#g" -e "s#@LOG_DIR@#$LOG_DIR#g" -e "s#@ACME_ROOT@#$ACME_ROOT#g" \
    -e "s#@HTTP_PORT@#$HTTP_PORT#g" -e "s#@HTTPS_PORT@#$HTTPS_PORT#g" -e "s#@PORT_SUFFIX@#$suffix#g" \
    -e "s#@LISTEN6_HTTP_DEFAULT@#$(l6 "$HTTP_PORT" ' default_server')#" -e "s#@LISTEN6_HTTPS_DEFAULT@#$(l6 "$HTTPS_PORT" ' ssl default_server')#" \
    -e "s#@LISTEN6_HTTP@#$(l6 "$HTTP_PORT" '')#" -e "s#@LISTEN6_HTTPS@#$(l6 "$HTTPS_PORT" ' ssl')#" "$HERE/../nginx/probe.conf.template" > "${OUT:-/dev/stdout}"
[ -z "$OUT" ] || echo "rendered into $OUT" >&2

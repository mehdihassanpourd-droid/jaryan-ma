#!/usr/bin/env bash
# Renders the nginx configuration of an installed (or unpacked) release into a directory. It never reloads nginx by itself
# unless --reload is given, and it refuses to leave a configuration that `nginx -t` rejects.
#
#   configure-nginx.sh --shop shop.example.ir --api api.example.ir --admin admin.example.ir --media media.example.ir \
#       [--out /etc/nginx/conf.d] [--tls-dir /etc/ssl/jaryan] [--no-tls] [--https-port 443] [--http-port 80] [--api-upstream 127.0.0.1:3001] \
#       [--s3-upstream 127.0.0.1:9000] [--bucket jaryan-media] [--web-root /var/www/jaryan-ma] [--readyz-allow 127.0.0.1] [--reload]
#
# With TLS (default) it expects <tls-dir>/<domain>/fullchain.pem and privkey.pem for each host (any CA; see OFFLINE-DEPLOY-FA.md).
# --no-tls renders plain HTTP on port 80 (rehearsals and tests only: production must use TLS).
set -euo pipefail
HERE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd -P)"
T="$HERE/nginx"
SHOP="" API="" ADMIN="" MEDIA="" OUT="/etc/nginx/conf.d" TLSDIR="/etc/ssl/jaryan" TLS=1 API_UP="127.0.0.1:3001" S3_UP="127.0.0.1:9000" BUCKET="jaryan-media" WEB="/var/www/jaryan-ma" READYZ="127.0.0.1" RELOAD=0 LISTEN_PORT="" HTTPS_PORT=443 HTTP_PORT=80
die() { echo "ERROR: $*" >&2; exit 64; }
while [ $# -gt 0 ]; do
  case "$1" in
    --shop) SHOP="$2"; shift 2 ;; --api) API="$2"; shift 2 ;; --admin) ADMIN="$2"; shift 2 ;; --media) MEDIA="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;; --tls-dir) TLSDIR="$2"; shift 2 ;; --no-tls) TLS=0; shift ;; --listen-port) LISTEN_PORT="$2"; shift 2 ;; --https-port) HTTPS_PORT="$2"; shift 2 ;; --http-port) HTTP_PORT="$2"; shift 2 ;;
    --api-upstream) API_UP="$2"; shift 2 ;; --s3-upstream) S3_UP="$2"; shift 2 ;; --bucket) BUCKET="$2"; shift 2 ;;
    --web-root) WEB="$2"; shift 2 ;; --readyz-allow) READYZ="$2"; shift 2 ;; --reload) RELOAD=1; shift ;;
    *) die "unknown option $1" ;;
  esac
done
for v in "$SHOP" "$API" "$ADMIN" "$MEDIA"; do
  [[ "$v" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "invalid or missing domain name '$v' (use --shop --api --admin --media)"
done
[[ "$BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,60}$ ]] || die "invalid bucket name"
[[ "$API_UP" =~ ^[0-9.]+:[0-9]+$ && "$S3_UP" =~ ^[0-9.]+:[0-9]+$ ]] || die "upstreams must be IPv4:port (the application and the object store listen on this machine only)"
for up in "$API_UP" "$S3_UP"; do
  case "$up" in 127.*|10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[01].*) ;; *) die "upstreams must be loopback or private addresses" ;; esac
done
[ "$TLS" = 1 ] && SCHEME=https || SCHEME=http
mkdir -p "$OUT"

render() {  # template -> file
  local src="$1" dst="$2" domain="$3" listen tls hsts
  if [ "$TLS" = 1 ]; then
    listen="listen $HTTPS_PORT ssl http2;"
    tls="ssl_certificate $TLSDIR/$domain/fullchain.pem; ssl_certificate_key $TLSDIR/$domain/privkey.pem; ssl_protocols TLSv1.2 TLSv1.3; ssl_session_timeout 1d; ssl_session_cache shared:jm_ssl:10m; ssl_prefer_server_ciphers off;"
    hsts='add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;'
  else
    listen="listen ${LISTEN_PORT:-80};"; tls=""; hsts=""
  fi
  sed -e "s#@LISTEN@#$listen#g" -e "s#@TLS@#$tls#g" -e "s#@HSTS@#$hsts#g" \
      -e "s#@SHOP_DOMAIN@#$SHOP#g" -e "s#@API_DOMAIN@#$API#g" -e "s#@ADMIN_DOMAIN@#$ADMIN#g" -e "s#@MEDIA_DOMAIN@#$MEDIA#g" \
      -e "s#@SHOP_ORIGIN@#$SCHEME://$SHOP#g" -e "s#@MEDIA_ORIGIN@#$SCHEME://$MEDIA#g" -e "s#@API_ORIGIN@#$SCHEME://$API#g" \
      -e "s#@WEB_ROOT@#$WEB#g" -e "s#@CONF_DIR@#$OUT#g" -e "s#@API_UPSTREAM@#$API_UP#g" -e "s#@S3_UPSTREAM@#$S3_UP#g" -e "s#@BUCKET@#$BUCKET#g" \
      -e "s#@READYZ_ALLOW@#allow $READYZ;#g" "$src" > "$dst"
}
render "$T/common.conf.template"      "$OUT/jaryan-common.conf"           "$SHOP"
render "$T/security-headers.conf"     "$OUT/jaryan-security-headers.conf" "$SHOP"
render "$T/proxy-api.conf"            "$OUT/jaryan-proxy-api.conf"        "$SHOP"
render "$T/shop-headers.conf"         "$OUT/jaryan-shop-headers.conf"     "$SHOP"
render "$T/s3-public.conf"            "$OUT/jaryan-s3-public.conf"        "$MEDIA"
render "$T/shop.conf.template"        "$OUT/jaryan-shop.conf"             "$SHOP"
render "$T/api.conf.template"         "$OUT/jaryan-api.conf"              "$API"
render "$T/admin.conf.template"       "$OUT/jaryan-admin.conf"            "$ADMIN"
render "$T/media.conf.template"       "$OUT/jaryan-media.conf"            "$MEDIA"
if [ "$TLS" = 1 ]; then
  # plain-HTTP hosts only redirect (and answer ACME HTTP-01 challenges if an offline-capable ACME client is used)
  cat > "$OUT/jaryan-redirect.conf" <<CONF
server {
  listen $HTTP_PORT;
  server_name $SHOP $API $ADMIN $MEDIA;
  location /.well-known/acme-challenge/ { root /var/www/acme; }
  location / { return 301 https://\$host\$request_uri; }
}
CONF
fi
echo "rendered into $OUT"
if command -v nginx >/dev/null 2>&1 && [ "$OUT" = "/etc/nginx/conf.d" ]; then
  nginx -t || die "nginx rejected the configuration (see above); fix it before reloading"
  [ "$RELOAD" = 1 ] && systemctl reload nginx && echo "nginx reloaded"
fi
exit 0

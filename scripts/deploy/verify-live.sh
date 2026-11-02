#!/usr/bin/env bash
# Proves a deployment is really live: the site answers on <base-url> AND serves the commit we just deployed.
#
#   verify-live.sh <base-url> <expected-commit> [timeout-seconds]
#
# The build writes out/build-info.json ({"commit":"<sha>"}); this polls <base-url>/build-info.json (cache-busted) until it names the
# expected commit, then checks that the home page and the shop pages answer 200 and are the expected Persian storefront.
# Exit 0 only when all of that holds; otherwise it prints what it saw and exits 1. Needs only curl and a POSIX shell: no secrets, no account.
set -u

base="${1:?usage: verify-live.sh <base-url> <expected-commit> [timeout-seconds]}"
want="${2:?missing expected commit}"
timeout="${3:-300}"
interval="${VERIFY_POLL_SECONDS:-10}"
base="${base%/}"
pages="${VERIFY_PAGES:-/ /cart /checkout /orders}"
brand='جریان ما'

fetch() { curl --silent --show-error --location --max-time 20 "$@"; }

deadline=$((SECONDS + timeout))
seen="(no answer)"
while :; do
  body="$(fetch "$base/build-info.json?v=$RANDOM$SECONDS" 2>/dev/null || true)"
  got="$(printf '%s' "$body" | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([0-9a-fA-F]*\)".*/\1/p' | head -n1)"
  if [ -n "$got" ]; then seen="$got"; fi
  if [ -n "$got" ] && [ "$got" = "$want" ]; then break; fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "::error title=Live site does not serve the deployed commit::$base serves commit '$seen', expected '$want' (waited ${timeout}s)." >&2
    exit 1
  fi
  sleep "$interval"
done

failed=0
for path in $pages; do
  code="$(fetch --output /tmp/verify-live.$$ --write-out '%{http_code}' "$base$path?v=$RANDOM" 2>/dev/null || echo 000)"
  if [ "$code" != "200" ]; then
    echo "::error title=Page not served::$base$path answered HTTP $code (200 expected)." >&2
    failed=1
  elif ! grep -q "$brand" /tmp/verify-live.$$; then
    echo "::error title=Unexpected page content::$base$path answered 200 but is not the Jaryan Ma storefront." >&2
    failed=1
  fi
done
rm -f /tmp/verify-live.$$
[ "$failed" = 0 ] || exit 1

echo "Verified: $base serves commit ${want:0:12} and its pages answer."

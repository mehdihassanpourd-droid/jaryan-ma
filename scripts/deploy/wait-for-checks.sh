#!/usr/bin/env bash
# Holds a production deployment until every OTHER check on the commit has finished green.
#
#   wait-for-checks.sh <owner/repo> <commit> [timeout-seconds] [exclude-regex]
#
# Reads the commit's check runs through the GitHub API (GH_TOKEN, `checks: read`). Exit 0 when nothing else is pending and nothing failed,
# 1 when any check failed (immediately) or the wait ran out. Checks that do not exist for this commit (path-filtered workflows) simply
# are not there. Check names matching <exclude-regex> (this workflow's own jobs, post-deploy reporters) are ignored.
set -u

repo="${1:?usage: wait-for-checks.sh <owner/repo> <commit> [timeout-seconds] [exclude-regex]}"
sha="${2:?missing commit}"
timeout="${3:-2400}"
exclude="${4:-^\$}"
interval="${CHECK_POLL_SECONDS:-20}"
deadline=$((SECONDS + timeout))

while :; do
  if lines="$(gh api "repos/$repo/commits/$sha/check-runs?per_page=100&filter=latest" --jq '.check_runs[] | "\(.name)\t\(.status)\t\(.conclusion // "")"' 2>/dev/null)"; then
    lines="$(printf '%s\n' "$lines" | grep -Ev -- "^($exclude)\s" | sed '/^$/d' || true)"
    failed="$(printf '%s\n' "$lines" | awk -F'\t' '$2=="completed" && ($3=="failure"||$3=="timed_out"||$3=="cancelled"||$3=="action_required"||$3=="startup_failure"||$3=="stale"){print $1" ("$3")"}')"
    pending="$(printf '%s\n' "$lines" | awk -F'\t' '$2!="completed"{print $1}')"
    if [ -n "$failed" ]; then
      echo "::error title=Deployment held back::A required check failed on $sha:" >&2
      printf '%s\n' "$failed" >&2
      exit 1
    fi
    if [ -z "$pending" ]; then
      echo "All other checks on ${sha:0:12} are green ($(printf '%s\n' "$lines" | sed '/^$/d' | wc -l | tr -d ' ') checked)."
      exit 0
    fi
    echo "Waiting for: $(printf '%s' "$pending" | tr '\n' ',' | sed 's/,$//')"
  else
    echo "Could not read the checks yet; retrying."
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "::error title=Deployment held back::Timed out waiting for the other checks on $sha." >&2
    exit 1
  fi
  sleep "$interval"
done

#!/usr/bin/env bash
# Helpers for the SEO monitor's history branch ("seo-data"): an orphan branch that holds only metrics and reports (never code), so the
# history costs nothing on main and the repository's default branch is never written to by automation.
#
#   data-branch.sh prepare   check the branch out into ./.seo-data (creating it, empty, the first time)
#   data-branch.sh publish   commit whatever changed in ./.seo-data and push it (no-op when nothing changed)
#
# Needs GH_TOKEN (the workflow's own token) and REPO (owner/name). The token is passed per command, never stored in git config.
set -euo pipefail

BRANCH="${SEO_DATA_BRANCH:-seo-data}"
DIR=".seo-data"
auth=(-c "http.extraheader=AUTHORIZATION: basic $(printf 'x-access-token:%s' "${GH_TOKEN:?GH_TOKEN is required}" | base64 -w0)")
# SEO_DATA_REMOTE exists for the script's own tests (a local bare repository); in the workflow it is always the repository itself.
remote="${SEO_DATA_REMOTE:-https://github.com/${REPO:?REPO is required}.git}"

case "${1:-}" in
  prepare)
    rm -rf "$DIR"
    if git "${auth[@]}" ls-remote --exit-code --heads "$remote" "$BRANCH" >/dev/null 2>&1; then
      git "${auth[@]}" fetch --depth 1 "$remote" "$BRANCH:refs/remotes/seo/$BRANCH"
      git worktree add -B "$BRANCH" "$DIR" "refs/remotes/seo/$BRANCH"
    else
      git worktree add --detach "$DIR"
      git -C "$DIR" checkout --orphan "$BRANCH"
      git -C "$DIR" rm -rf . >/dev/null 2>&1 || true
      printf '# SEO monitoring data\n\nMetrics history and generated reports. Written only by the "SEO monitor" workflow; never merge this branch.\n' > "$DIR/README.md"
    fi
    ;;
  publish)
    git -C "$DIR" config user.name "seo-monitor"
    git -C "$DIR" config user.email "seo-monitor@users.noreply.github.com"
    git -C "$DIR" add -A
    if git -C "$DIR" diff --cached --quiet; then
      echo "No new SEO data: nothing to commit."
      exit 0
    fi
    git -C "$DIR" commit -q -m "SEO data $(date -u +%F)"
    for attempt in 1 2 3; do
      if git "${auth[@]}" -C "$DIR" push "$remote" "HEAD:refs/heads/$BRANCH"; then exit 0; fi
      # Someone (a manual run) pushed first: rebuild on top of it and try again.
      git "${auth[@]}" -C "$DIR" fetch --depth 1 "$remote" "$BRANCH" || true
      git -C "$DIR" rebase -X theirs FETCH_HEAD || git -C "$DIR" rebase --abort || true
      sleep $((attempt * 3))
    done
    echo "::error::Could not push the SEO data branch."
    exit 1
    ;;
  *)
    echo "usage: data-branch.sh prepare|publish" >&2
    exit 64
    ;;
esac

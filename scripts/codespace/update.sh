#!/usr/bin/env bash
# Brings this Codespace's checkout up to date with origin/main, SAFELY, and applies what changed:
#   - it only ever moves FORWARD (fast-forward): it never resets, cleans, force-pushes, or discards anything;
#   - it refuses (and says why) when tracked files have local edits, or this checkout has commits that are not on main;
#   - it never touches the data directory (.data/ is git-ignored: PostgreSQL data, accounts, uploaded images stay);
#   - dependencies are reinstalled only if package files changed; migrations (idempotent, additive) only if prisma/ changed.
# Exit status is always 0 (an update problem must never stop the app from starting); read the "[update]" lines.
# Env (tests only): JARYAN_UPDATE_REMOTE (origin), JARYAN_UPDATE_BRANCH (main), JARYAN_UPDATE_DRY=1 (print steps, run none).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REMOTE="${JARYAN_UPDATE_REMOTE:-origin}"
BRANCH="${JARYAN_UPDATE_BRANCH:-main}"
DRY="${JARYAN_UPDATE_DRY:-}"
cd "$ROOT"

log() { echo "[update] $*"; }
short() { git rev-parse --short "$1" 2>/dev/null || echo "?"; }
step() { if [ -n "$DRY" ]; then log "would run: $*"; else log "running: $*"; "$@"; fi; }

git rev-parse --git-dir >/dev/null 2>&1 || { log "not a git checkout: nothing to update"; exit 0; }
timeout 60 git fetch --quiet "$REMOTE" "$BRANCH" 2>/dev/null || { log "cannot reach $REMOTE/$BRANCH (offline?): keeping version $(short HEAD)"; exit 0; }

target="$REMOTE/$BRANCH"
old="$(git rev-parse HEAD)"
new="$(git rev-parse "$target")"
current="$(git rev-parse --abbrev-ref HEAD)"

if [ "$old" = "$new" ] && [ "$current" = "$BRANCH" ]; then log "already up to date ($(short HEAD))"; exit 0; fi
if [ "$old" = "$new" ]; then log "already at $(short HEAD) (on branch $current)"; exit 0; fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  log "tracked files have local changes: NOT updating (still $(short HEAD); target $(short "$target"))"
  exit 0
fi
if ! git merge-base --is-ancestor "$old" "$new"; then
  log "this checkout has commits that are not on $BRANCH: NOT updating (still $(short HEAD))"
  exit 0
fi

if [ "$current" != "$BRANCH" ]; then
  # Everything on this branch is already contained in main, so moving to main loses nothing.
  if git rev-parse --verify -q "refs/heads/$BRANCH" >/dev/null && ! git merge-base --is-ancestor "refs/heads/$BRANCH" "$new"; then
    log "local $BRANCH has commits that are not on $REMOTE/$BRANCH: NOT updating"
    exit 0
  fi
  log "branch $current is fully merged into $BRANCH: switching to $BRANCH"
  git checkout --quiet -B "$BRANCH" "$target" || { log "could not switch branch: NOT updating"; exit 0; }
  git branch --quiet --set-upstream-to="$target" "$BRANCH" 2>/dev/null || true
else
  git merge --quiet --ff-only "$target" || { log "fast-forward failed: NOT updating"; exit 0; }
fi

log "updated $(short "$old") -> $(short HEAD)"
changed="$(git diff --name-only "$old" HEAD)"
touched() { echo "$changed" | grep -qE "$1"; }

if touched '^(package\.json|package-lock\.json)$'; then
  step npm ci --no-audit --no-fund
  step npm run --silent db:generate
elif touched '^prisma/'; then
  step npm run --silent db:generate
fi
if touched '^prisma/migrations/'; then
  # Additive, idempotent: applies only migrations this database has not seen. Existing data is preserved.
  if [ -n "$DRY" ]; then log "would run: prisma migrate deploy"; else start_db && DATABASE_URL="$(database_url)" step npx prisma migrate deploy; fi
fi
if touched '^(admin/|scripts/admin/|package\.json)'; then
  step npm run --silent admin:build
fi
log "done: now running $(short HEAD)"
exit 0

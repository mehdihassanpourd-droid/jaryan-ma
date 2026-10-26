# Technical maintenance

Status: **designed, implemented and tested in code; not deployed.** Everything here is free (open-source tooling, GitHub Actions free tier). Nothing is monitored in production yet because there is no production server.

> **Honesty rule.** The system never reports a backup as working because a job ran. A database backup is **operational only after a restore from a recent backup has been performed and verified** (`src/domain/maintenance/backup.ts`, tested). Until the first successful restore test, status is `none` → `untested`.

## 1. Implemented vs planned

| Area | Implemented | Planned / needs the owner |
|---|---|---|
| Health monitoring (server) | `HealthReport` with checks: database, migrations, object storage write, backup state, recent error volume, overdue account deletions, security configuration. `GET /health` (public, status only), detailed report for owners (`GET /api/v1/maintenance/health`, `npm run ops -- health`), 5-minute internal cycle that opens/resolves one incident automatically | external uptime probe from outside Iran/Cloudflare edge (the GitHub workflow below is the free option) |
| Website uptime | `.github/workflows/site-health.yml` (every 2 h; opens/closes a GitHub issue) — **inactive until the repository variables `SITE_URL` / `API_HEALTH_URL` are set** | alerts to phone/SMS (needs a decision; GitHub issue notifications are the free default) |
| Deployment failure detection | `.github/workflows/deployment-watch.yml` — issue when the *Cloudflare Pages* workflow fails on `main`, closed on next success | server-side deployment: use `npm run ops -- log-action` from the deploy script to write the audit trail |
| Incident tracking | `Incident` + timeline updates, severity, source, transitions; API for owners | status page for customers |
| Security checks | `securityChecks()` configuration review (also `npm run ops -- security-check`); static invariant tests in CI; `Security audit` workflow (`npm audit`); tests for CSRF, origins, roles, rate limits | external penetration test, WAF, intrusion detection |
| Error reporting | server-side unhandled errors and storefront errors (`POST /api/v1/public/client-errors`) → sanitised, de-duplicated by fingerprint, counted; owners list/resolve | the storefront snippet that sends errors (no storefront code changed in this work) |
| Backup & restore | `npm run ops -- backup`, `restore-test`, `backup-status`; AES-256-GCM encrypted `pg_dump` with consistent snapshot manifest; automated restore test into a scratch DB with exact row-count comparison; verified against real PostgreSQL 16 | **scheduling on the server; off-site copy; media (S3) backups; the first production restore drill** |
| Maintenance audit log | `MaintenanceLog` for deployments, backups, restore tests, incidents, security checks; secrets scrubbed; 400-day retention | — |

## 2. Health model

Checks (`src/domain/maintenance/health.ts`): each returns `ok | warn | fail` with a short message that **never contains connection strings, hostnames or personal data** (tested: a failing database probe whose error text contains a password produces `"check failed"`).

* `down` = the database or migrations fail; `degraded` = any other failure or warning; `ok` otherwise.
* `GET /health` (no authentication) returns **only** `{status, checkedAt}` (HTTP 503 when `down`), cached for 30 s so it cannot be used to hammer the database. `GET /healthz` is the plain liveness probe.
* `healthCycle()` runs every 5 minutes inside the server: while any check *fails* it keeps exactly one `health_check` incident open (critical when `down`, major otherwise) and resolves it when everything passes. Warnings do not open incidents.

## 3. Free automation

| Workflow | Trigger | Needs |
|---|---|---|
| `site-health.yml` | every 2 h, manual | repo **variables** `SITE_URL` (+ optional `API_HEALTH_URL`). No secrets. |
| `deployment-watch.yml` | after the *Cloudflare Pages* workflow completes on `main` | nothing |
| `security-audit.yml` | weekly, on dependency changes | nothing (blocks on HIGH/CRITICAL in production dependencies) |
| `database.yml` | server/prisma changes | nothing (PostgreSQL 16 service container; runs all server tests and the real backup/restore test; fails on schema/migration drift) |
| `cloudflare-pages.yml` | **unchanged** | existing secrets |

Limits to know: GitHub pauses scheduled workflows after 60 days without repository activity; the free tier has a monthly minutes quota (these jobs use well under a minute each); the probe runs from GitHub's network, which tells you the site is reachable from there, not from Iran.

## 4. Backup and restore

### What a backup is
`npm run ops -- backup` (on the server, with the server's environment):
1. opens a read-only `REPEATABLE READ` transaction and exports its snapshot;
2. runs `pg_dump --format=custom --snapshot=…` (credentials via `PG*` environment variables, never in the process list);
3. counts rows of every table **in that same snapshot** and writes a manifest (`*.manifest.json`: row counts, finished migrations, SHA-256 of the dump);
4. encrypts the dump with AES-256-GCM (`BACKUP_ENCRYPTION_KEY`, 32 random bytes base64 — **keep it in a password manager, separate from the server**) and deletes the plaintext; refuses to run without a key (backups hold personal data);
5. registers it as **taken (not verified)**, prunes files older than `BACKUP_KEEP_DAYS` (30).

### What proves it works
`npm run ops -- restore-test` (set `RESTORE_TEST_ADMIN_URL` to a CREATEDB connection on a **scratch** PostgreSQL server; refuses the production host unless `--allow-same-server`):
1. checks the file's SHA-256 against the manifest (detects corruption/tampering);
2. decrypts (wrong key or modified file → authentication failure → test fails);
3. creates a throw-away database, `pg_restore --exit-on-error`;
4. compares **every table's row count and the migration history** with the manifest;
5. drops the scratch database whatever happens, and records the result. A failure opens a `backup` incident.

`npm run ops -- backup-status` exits 0 only when the state is `operational` = newest backup ≤ 36 h old **and** a successful restore test ≤ 35 days old.

| State | Meaning |
|---|---|
| `none` | nothing recorded |
| `untested` | backups exist, none ever restored successfully — **not operational** |
| `restore_failed` | the latest restore test failed — **not operational** |
| `stale_backup` / `stale_restore_test` | too old |
| `operational` | recent backup + recent successful restore test |

### Verified so far (honest status)
* Encryption round-trip, wrong-key, tamper and truncation detection: unit-tested.
* `pg_dump` → encrypted file → `pg_restore` into a scratch database → exact comparison, plus the failure cases (wrong key, manifest mismatch, corrupted file) and cleanup of the scratch database: tested against a **real PostgreSQL 16** (locally and in the `database.yml` CI job). The CLI flow (`backup` → `untested` → `restore-test` → `operational`) was also run by hand against a local PostgreSQL 16.
* **Not done:** there is no production server, so **no production backup exists and none may be called operational.** The first real drill must be performed on the production host after install (checklist §6).
* **Media (S3 bucket) backups** have a register and the same state machine (`kind = media`) but no automated tool: mirror the bucket with `mc mirror`/`rclone` to a second location, register it with `POST /api/v1/maintenance/backups`, and record an actual test restore (download and open a sample).

### Scheduling (systemd timer on the server)
```ini
# /etc/systemd/system/jaryan-backup.service
[Service]
Type=oneshot
User=jaryan
WorkingDirectory=/opt/jaryan-ma
EnvironmentFile=/etc/jaryan-ma/api.env
EnvironmentFile=/etc/jaryan-ma/backup.env     # BACKUP_DIR, BACKUP_ENCRYPTION_KEY, RESTORE_TEST_ADMIN_URL
ExecStart=/usr/bin/node dist/server/cli/ops.mjs backup
# /etc/systemd/system/jaryan-backup.timer  ->  OnCalendar=*-*-* 03:30:00  Persistent=true
# weekly: ExecStart=... ops.mjs restore-test   (separate service + timer, Sunday 04:30)
```
Copy `BACKUP_DIR` **off the server** (the backup protects against a server loss only if it is elsewhere).

## 5. Incident tracking

`Incident` (number, title, severity `minor|major|critical`, status `investigating → identified → monitoring → resolved`, source `manual|health_check|deployment|security|backup`) with timestamped `IncidentUpdate`s. Owners use `POST /api/v1/maintenance/incidents` and `…/:number/updates`; a resolved incident can be reopened to `investigating`. The health cycle and failed restore tests open incidents automatically. Every change is also in the maintenance log.

## 6. Error reporting

* Sources: unhandled server errors (error *name* only, never request data) and the storefront endpoint.
* Everything is **sanitised before storage**: credentials in URLs, bearer tokens, JWTs, `password=`/`token=`-style pairs, e-mail addresses, Iranian phone numbers, long hex/base64 strings are redacted; URLs lose query string and fragment; sizes are capped (message 500, stack 4,000 characters).
* De-duplicated by a fingerprint (source + name + message with numbers blanked + first stack frame): "order 17 failed" and "order 998 failed" are one group with a counter; a resolved group reopens when it recurs. Resolved groups are pruned after 90 days.
* The public ingest endpoint is unauthenticated by nature: it is limited to the storefront origin, 24 KB, strict schema, and 30 reports per client address per hour.

## 7. Security checks

`npm run ops -- security-check` and the health report review the **running configuration** (encryption key present, Secure cookies, mandatory TOTP, HTTPS explicit admin origins, S3 storage, real PostgreSQL, no development admin, HTTPS media URL, proxy trust, and — when customer accounts are enabled — a real SMS gateway). In production a bad value is a failure; in development it is a warning. The server also refuses to *start* with most of these wrong (config tests).

CI guard-rails (`server/invariants.test.ts`): storefront code never imports server/Prisma code or calls API paths; static export intact; no `.env`/keys/dumps tracked; `.env.example` holds placeholders only; no `Math.random` in server code; no secret-bearing fields in API modules; customer support queries never touch internal notes; workflows pinned to commit SHAs, least-privilege permissions, no `pull_request_target`, no attacker-controlled event text interpolated.

## 8. Maintenance audit log

`maintenance_log(at, actor, action, target, outcome, detail)` — separate from the catalogue audit log. Written by: incident changes, backup/restore events, security checks, automatic incident open/close, and your deploy scripts:

```bash
node dist/server/cli/ops.mjs log-action --action deploy --target "release:$(git rev-parse --short HEAD)" --outcome success --actor "$USER"
```
`detail` is scrubbed (secret-looking keys and values are redacted). Owners read it at `GET /api/v1/maintenance/log`. Entries older than 400 days are pruned.

## 9. Runbooks

* **Site down (storefront):** Cloudflare Pages status and the latest *Cloudflare Pages* workflow run; the deployment-watch issue links the failing run. The previous deployment stays live when a build fails.
* **API down:** `journalctl -u jaryan-api`, `ops health` (database? migrations? storage?), restart; check disk space and PostgreSQL.
* **Database lost:** restore the latest verified encrypted backup into PostgreSQL (`pg_restore --clean --if-exists --no-owner -d jaryan`), run `prisma migrate deploy`, restart, run `ops health`. The same steps are what `restore-test` rehearses.
* **Secret leaked:** rotate it (S3 keys, SMS token); for `APP_ENCRYPTION_KEY` re-enrol TOTP seeds and expect all customer codes to be invalidated (the OTP key derives from it); sign out all sessions by disabling/re-enabling accounts; log the action with `ops log-action`.
* **SMS cost spike:** lower `SMS_DAILY_LIMIT` and restart; set `CUSTOMER_ACCOUNTS_ENABLED=false` to stop sending entirely.

### First production restore drill (checklist)
1. Install per SELF-HOSTING.md, create `/etc/jaryan-ma/backup.env` with a fresh `BACKUP_ENCRYPTION_KEY`; store that key off-server.
2. `ops backup` → `ops backup-status` must say `untested` (exit 1).
3. Provide a scratch PostgreSQL (can be a second cluster or another machine), set `RESTORE_TEST_ADMIN_URL`, `ops restore-test` → must print `RESTORE TEST PASSED`.
4. `ops backup-status` → `operational` (exit 0). Only now may the owner call backups operational.
5. Copy the encrypted file off-server and, once, decrypt+restore *that copy* to prove the off-site path works.

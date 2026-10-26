# Self-hosting the admin system (Iran or anywhere)

Reference instructions for running the admin API on one Linux server. The configuration files below are **references, untested in CI**; adapt them to your hosting provider. Nothing here creates any cloud resource or spends money by itself.

Requirements: Linux (Ubuntu LTS assumed), Node.js 22 LTS, PostgreSQL ≥ 14 (16 recommended), a reverse proxy with TLS (nginx shown), an S3-compatible store (MinIO or a provider).

## 1. PostgreSQL

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE jaryan LOGIN PASSWORD 'use-a-long-random-password';
-- ICU Persian collation gives correct alphabetical sorting (PostgreSQL 15+; verify for your version):
CREATE DATABASE jaryan OWNER jaryan TEMPLATE template0 ENCODING UTF8 LOCALE_PROVIDER icu ICU_LOCALE 'fa-IR';
SQL
```
Listen on localhost only (`listen_addresses = 'localhost'`) and keep the port closed in the firewall.

## 2. Object storage (S3-compatible)

Either an S3-compatible provider, or MinIO on the same host (bind it to localhost and expose only the public read path through the proxy):

```bash
# bucket "jaryan-media": public read for images/* and catalog/*, no listing, no public write
```
Allow CORS `GET` for the storefront origin(s). Keep private data out of this bucket.

## 3. Install and configure the API

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin jaryan
sudo -u jaryan git clone https://github.com/mehdihassanpourd-droid/jaryan-ma /opt/jaryan-ma
cd /opt/jaryan-ma && sudo -u jaryan npm ci          # full install: the Prisma CLI is needed for migrations
sudo -u jaryan npm run api:build                    # bundles the server to dist/server
```

Environment file `/etc/jaryan-ma/api.env` (`chmod 600`, owned by the service user; **never commit it**):

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
DATABASE_URL=postgresql://jaryan:PASSWORD@127.0.0.1:5432/jaryan
STORAGE_DRIVER=s3
S3_ENDPOINT=https://s3.example.ir
S3_REGION=us-east-1
S3_BUCKET=jaryan-media
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true
PUBLIC_MEDIA_URL=https://media.example.ir
ADMIN_ORIGINS=https://admin.example.ir
APP_ENCRYPTION_KEY=...        # openssl rand -base64 32 ; back it up: without it TOTP seeds cannot be decrypted
TRUST_PROXY=true              # only because nginx on this host sets X-Forwarded-For
```
The server refuses to start in production if anything required is missing, and never prints secret values. `REQUIRE_TOTP=false`, `COOKIE_SECURE=false` and `DEV_ADMIN_*` are rejected in production.

Apply the schema and create the first owner:

```bash
set -a; . /etc/jaryan-ma/api.env; set +a
npx prisma migrate deploy
npm run admin:prod -- create --email you@example.ir --role owner      # hidden password prompt, then scan the TOTP secret/URI
```

## 4. Service (systemd)

```ini
# /etc/systemd/system/jaryan-api.service
[Unit]
Description=Jaryan Ma admin API
After=network.target postgresql.service

[Service]
User=jaryan
WorkingDirectory=/opt/jaryan-ma
EnvironmentFile=/etc/jaryan-ma/api.env
ExecStart=/usr/bin/node dist/server/main.mjs
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

## 5. Reverse proxy (nginx)

```nginx
limit_req_zone $binary_remote_addr zone=login:10m rate=10r/m;

server {
  listen 443 ssl;
  server_name admin.example.ir;
  # ssl_certificate / ssl_certificate_key ...
  client_max_body_size 6m;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

  location = /api/v1/auth/login {
    limit_req zone=login burst=5 nodelay;          # defence in depth on top of the app's limits
    include /etc/nginx/jaryan-proxy.conf;
  }
  location / { include /etc/nginx/jaryan-proxy.conf; }
}
# /etc/nginx/jaryan-proxy.conf
#   proxy_pass http://127.0.0.1:3001;
#   proxy_set_header Host $host;
#   proxy_set_header X-Forwarded-For $remote_addr;   # overwrite, never append: the app trusts the last entry
#   proxy_set_header X-Forwarded-Proto $scheme;
```
Firewall: only 80/443 (and SSH) public. PostgreSQL, MinIO's API/console and the Node port stay on localhost.

## 6. Backups and recovery

* Database: `pg_dump -Fc jaryan > /var/backups/jaryan-$(date +%F).dump` daily (cron/systemd timer), keep ≥ 14 days, copy **off the server**.
* Media: mirror the bucket (`mc mirror` for MinIO, or the provider's tools) to a second location.
* Secrets: keep `APP_ENCRYPTION_KEY` and the env file in a password manager. **Test a restore** (`pg_restore` into a scratch database) at least once before relying on it.
* If a phone is lost: `npm run admin:prod -- reset-totp --email …`; forgotten password: `reset-password`; compromised account: `disable` (also signs out every session).

## 7. Updating

```bash
cd /opt/jaryan-ma && sudo -u jaryan git pull && sudo -u jaryan npm ci && sudo -u jaryan npm run api:build
set -a; . /etc/jaryan-ma/api.env; set +a; npx prisma migrate deploy
sudo systemctl restart jaryan-api
```
Take a database backup before applying migrations. Logs are JSON lines on stdout (`journalctl -u jaryan-api`); they contain error names and events, never secrets.

## 8. Local development (no server needed)

See [ARCHITECTURE.md §8](ARCHITECTURE.md#8-local-development-and-tests-without-any-cloud-service): `npm test` and `npm run api:dev` use an embedded PostgreSQL and local disk and need no external services.

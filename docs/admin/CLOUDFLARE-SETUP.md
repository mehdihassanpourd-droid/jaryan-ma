# Cloudflare setup for the admin system

> **Do not run anything here until the owner has approved it.** Creating these resources can involve billing (see [ARCHITECTURE.md §10](ARCHITECTURE.md)). Nothing in this repository creates them automatically, and the existing Pages workflow does not touch them.

## Resources

| # | Resource | Purpose | Paid? |
|---|---|---|---|
| 1 | D1 database `jaryan-ma-admin` | products, categories, admins, audit log | free tier (Workers Free plan) |
| 2 | R2 bucket `jaryan-ma-public` + custom domain `cdn.<domain>` | product images and public catalogue JSON | free tier; **may require a payment method to enable** |
| 3 | Worker `jaryan-ma-admin` (this folder: `workers/admin-api`) | admin API (later also the admin UI as static assets) | free tier; Paid optional |
| 4 | Zero Trust **Access** application on `admin.<domain>` | sign-in, MFA, session | free for small teams (verify) |
| 5 | Cloudflare API token for deployments | `wrangler deploy` from CI | free |

The Pages project `jaryan-ma` (the storefront) is unchanged.

> ⚠️ Do **not** create a `functions/` directory at the repository root. Wrangler bundles a `functions/` folder next to where `wrangler pages deploy` runs, which would silently turn the static site into a Functions project. The admin code lives in `workers/admin-api/` and is deployed separately.

## Steps (after approval)

1. **Configuration file.** `cp workers/admin-api/wrangler.toml.example workers/admin-api/wrangler.toml` and fill the placeholders. It holds identifiers only (database id, team domain, AUD tag, origins), not secrets.
2. **Create the database and apply the schema**
   ```bash
   cd workers/admin-api
   npx wrangler d1 create jaryan-ma-admin          # copy the database_id into wrangler.toml
   npx wrangler d1 migrations apply jaryan-ma-admin --remote
   ```
3. **Create the bucket** (dashboard → R2, or `npx wrangler r2 bucket create jaryan-ma-public`), then attach a custom domain such as `cdn.<domain>` and set `PUBLIC_BUCKET_URL`. Set the bucket CORS policy to allow `GET` from the storefront origin only. Keep only public data in this bucket.
4. **Protect the admin hostname with Access** (Zero Trust dashboard → Access → Applications → Self-hosted)
   * Domain: `admin.<domain>`; policy *Allow* for the specific admin emails only; session duration 12–24 h; enable MFA at the identity provider.
   * Copy the application's **AUD tag** to `ACCESS_AUD` and your team domain (`<team>.cloudflareaccess.com`) to `ACCESS_TEAM_DOMAIN`.
5. **Add the first owner** (once, from your own machine; there is deliberately no default admin):
   ```bash
   npx wrangler d1 execute jaryan-ma-admin --remote \
     --command "INSERT INTO admins (email, role, disabled, created_at) VALUES ('you@example.com', 'owner', 0, datetime('now'))"
   ```
6. **Set `ADMIN_ORIGINS`** to the exact admin origin (e.g. `https://admin.<domain>`); without it every write is refused.
7. **Deploy:** `npx wrangler deploy` from `workers/admin-api`. Disable `workers.dev` and preview URLs (the template does) so the Worker is only reachable through the Access-protected hostname.
8. **Verify:** unauthenticated requests get `401`/Access login; a signed-in non-admin gets `403`; `GET /healthz` returns `{"ok":true}` and nothing else is public.

## Credentials

* Never paste tokens into chat, issues, code or CI logs. Store the deployment token as a GitHub Actions secret and give it only the permissions it needs (Workers Scripts: Edit, D1: Edit, R2: Edit for this account).
* The Access team domain and AUD tag are identifiers, not secrets, but keep them in `wrangler.toml` only for this project.
* To revoke access: set `disabled = 1` for the admin row and remove them from the Access policy; rotate the API token if it may have been exposed.

## Rolling back

Deleting the Worker, D1 database, R2 bucket and Access application removes everything; the public site does not depend on them until the storefront is explicitly wired to the snapshots.

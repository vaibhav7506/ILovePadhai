# ExamForge deployment and operations

The repository is production-shaped for one Cloudflare Worker with Static Assets, Hono, D1, R2,
KV, Turnstile, Cloudflare Access and optional Web Analytics. The checked-in binding IDs are
placeholders; a public deployment has not been claimed.

## 1. Authenticate and create production resources

```powershell
npx wrangler login
npx wrangler whoami
npx wrangler d1 create examforge-db
npx wrangler kv namespace create PUBLIC_CACHE
npx wrangler r2 bucket create examforge-documents
```

Copy the returned D1 database ID and KV namespace ID into the `production` section of
`wrangler.jsonc`. R2 uses the checked-in bucket name.

In Cloudflare Dashboard, create:

1. Turnstile → Add widget → Managed mode → include the final `*.workers.dev` hostname.
2. Zero Trust → Access → Applications → Self-hosted → protect `/api/admin/*`.
3. Web Analytics → Add site, if anonymous product analytics are wanted.

Replace `TURNSTILE_HOSTNAMES`, `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in production configuration.
Set `VITE_CF_WEB_ANALYTICS_TOKEN` only when Web Analytics is enabled.

## 2. Store secrets

Generate a signing secret locally, then paste only its value into Wrangler:

```powershell
$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
npx wrangler secret put ATTEMPT_SIGNING_SECRET --env production
npx wrangler secret put TURNSTILE_SECRET_KEY --env production
```

Groq is disabled by default. To opt in:

```powershell
npx wrangler secret put GROQ_API_KEY --env production
```

Then set `GROQ_ENABLED` to `on`. Never prefix Groq or secret names with `VITE_`.

For local development, copy `.dev.vars.example` to `.dev.vars` and use non-production values.
`.dev.vars` is ignored and must never be committed.

## 3. Validate, migrate and deploy

```powershell
npm ci
npm run cf:types
npm run lint
npm run typecheck
npm test
npm run test:pipeline
npm run test:e2e
npm audit --omit=dev --audit-level=moderate
npm run deploy:dry
npx wrangler d1 migrations apply examforge-db --remote --env production
npm run deploy
```

After deploy:

```powershell
npx wrangler tail examforge
Invoke-WebRequest https://examforge.<workers-subdomain>.workers.dev/api/health
```

Verify installation, offline library, Turnstile, admin Access denial, one complete timed attempt and
data deletion on the deployed hostname before announcing availability.

## Preview environment

Create separate preview D1/KV/R2 resources, replace the preview placeholder IDs, hostname and Access
values, then:

```powershell
npx wrangler secret put ATTEMPT_SIGNING_SECRET --env preview
npx wrangler secret put TURNSTILE_SECRET_KEY --env preview
npx wrangler d1 migrations apply examforge-preview-db --remote --env preview
npm run deploy:dry:preview
npm run deploy:preview
```

## Backup and rollback

Create a D1 export before migrations:

```powershell
New-Item -ItemType Directory -Force backups
npx wrangler d1 export examforge-db --remote --output backups/examforge-before-migration.sql
```

R2 source documents should retain their official-source copy and checksum. For an account-level
backup, configure an R2 lifecycle/replication policy in the dashboard or copy objects with an
S3-compatible backup client.

List versions and roll back application code:

```powershell
npx wrangler versions list
npx wrangler rollback <VERSION_ID>
```

A code rollback does not reverse D1. Apply the reviewed matching file under
`db/migrations/rollbacks` only after backing up D1 and checking whether newer data depends on the
schema.

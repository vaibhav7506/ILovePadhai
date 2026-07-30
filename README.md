# ExamForge

ExamForge is a completed six-phase, mobile-first government-examination preparation platform. It
provides verified-content provenance, server-authoritative examination attempts and results,
privacy-preserving leaderboards, personalised preparation and an installable offline-capable PWA.
There is no public account system.

## Local setup

Requirements: Node.js 22.22+ and npm.

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Open `http://127.0.0.1:5173`. Local D1, KV and R2 data lives under `.wrangler/state`.

## Verification

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run deploy:dry
```

Install the Playwright browser once with `npm run test:e2e:install` if Chromium is missing.

## Cloudflare resources

Replace the local placeholder D1/KV identifiers in `wrangler.jsonc` after creating resources:

```powershell
npx wrangler d1 create examforge-db
npx wrangler kv namespace create PUBLIC_CACHE
npx wrangler r2 bucket create examforge-documents
npx wrangler d1 migrations apply examforge-db --remote
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put ATTEMPT_SIGNING_SECRET
npm run deploy -- --env production
```

Create separate resource IDs for preview and production before deploying. Configure a Turnstile
widget with the deployment hostname, set `TURNSTILE_MODE` to `enforced`, expose only its site key
to the client, and keep the secret in Wrangler. Production Turnstile activation is intentionally
off until a real hostname and widget exist; the server-side validator is ready.

To enable Cloudflare Web Analytics, set `VITE_CF_WEB_ANALYTICS_TOKEN` at build time. The beacon
loads only when anonymous analytics consent is enabled.

## Architecture

- `src/client`: React interface and browser identity
- `src/server`: Hono Worker APIs, D1 writes, security and Turnstile validation
- `src/shared`: runtime schemas and data-driven examination catalogue
- `db/schema`: Drizzle schema
- `db/migrations`: forward SQL and explicit rollback SQL
- `tests`: Vitest unit tests and Playwright browser/API tests
- `docs`: phase records and operational notes

See the [Phase 6 production-readiness record](docs/phase-6-production-readiness.md),
[deployment runbook](docs/deployment.md), earlier phase records and
[architecture decisions](docs/architecture.md).

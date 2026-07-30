# Phase 1 completion record

## Completed

- Strict React, Vite and TypeScript foundation with Tailwind, Hono and Workers Static Assets.
- Local, preview and production Wrangler environments and D1/KV/R2 bindings.
- Drizzle schema and reversible migration for visitors, sessions, events and consent.
- Persistent anonymous browser UUID and separate session identity.
- Race-safe public learner numbering and truthful global footfall display.
- Responsive examination-focused homepage with the two required catalogue levels.
- Honest empty and verification states for papers, notices, diagnostic and revision.
- Concise privacy page and anonymous analytics opt-out.
- Security headers, environment validation, crawler filter, rate limit and Turnstile validator.
- Unit, browser and API test coverage for the Phase 1 acceptance path.

## Known limitations

- No examination is unlocked until verified content arrives in Phase 2.
- Production Cloudflare resource IDs, Turnstile widget/secret and Web Analytics token require the
  owner's Cloudflare account and deployment hostname.
- The full development-dependency audit reports four moderate findings in Drizzle Kit's deprecated
  internal esbuild loader. It is not shipped in the Worker bundle or used by the local app server;
  `npm audit --omit=dev --audit-level=moderate` reports zero production vulnerabilities.
- React Router 8.3.0 resolves the current router advisories and requires Node.js 22.22 or newer.
- The anonymous-data deletion endpoint exists, but its destructive confirmation UI is scheduled
  for the Phase 6 privacy controls.
- The public count intentionally starts at zero in a fresh database.

## Phase 2

Phase 2 adds the official-source registry, controlled ingestion and review pipeline, verified
questions and papers, answer-key versioning, data-driven patterns and cutoffs, cited notes, and
Cloudflare Access-protected administration.

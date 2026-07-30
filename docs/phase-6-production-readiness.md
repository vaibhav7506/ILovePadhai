# Phase 6 — production readiness

Phase 6 completes the planned ExamForge product. It adds a versioned service worker, installable
manifest, explicit offline downloads, an offline-only self-assessment desk, background recovery
hooks, update/offline banners and device-storage cleanup.

## Resilience decisions

- Only the application shell and same-origin static resources are cached automatically.
- Notes and practice packs enter `examforge-explicit-downloads-v1` only after the learner presses
  Download.
- An offline practice pack is capped at 20 published questions whose current answer key is final
  (official PYQ) or editorial (non-PYQ).
- Offline results never call attempt, scoring, readiness or leaderboard APIs. They are labelled
  local-only and `competitiveEligible: false`.
- Active online attempts keep pending response mutations in local storage. Reconnection and
  Background Sync retry them. Final submission is refused until every pending response is accepted
  by the server.
- Cache names are versioned. Activation removes obsolete application caches while preserving the
  explicit-download cache.

## Security and privacy decisions

- JSON writes reject cross-site browser requests using `Origin` and `Sec-Fetch-Site`.
- All database inputs stay bound parameters and public path/query values use Zod validation.
- Registration, analytics events and question reports have separate KV-backed limits.
- Attempt tokens and score calculation remain server-authoritative. Normal attempt payloads never
  contain answer keys before submission.
- Static and Worker responses use CSP, HSTS, Permissions Policy, clickjacking, MIME-sniffing and
  cross-origin isolation headers.
- Production and preview require Turnstile and Cloudflare Access for admin routes.
- `Reset my data` requires typing `DELETE`; the API also requires `x-confirm-delete: DELETE`.
  Cascading foreign keys remove attempts, responses, events, study data, reports and leaderboard
  profile. The browser clears its ExamForge local/cache data.
- No permanent full IP, contact detail or browser fingerprint is stored.

## Performance and operations

- Route components are lazy-loaded and emitted as separate production chunks.
- Hashed assets use one-year immutable browser caching; the service worker itself is never cached.
- Public offline catalogue responses are bounded and cacheable. Leaderboards accept page/pageSize
  and return at most 50 rows.
- D1 indexes cover operational event scans, moderation queues, ingestion failures and offline
  catalogue lookups.
- `/api/health/live` checks the application process. `/api/health` checks D1, the R2 binding,
  published-content version and Groq configuration without returning secrets.
- Every API request emits structured status/latency JSON and `Server-Timing`. Cloudflare logs and
  5% trace sampling are enabled in Wrangler.

## Verification snapshot

- Production client routes are split; the base client is about 78 kB gzip.
- Local production-static Lighthouse: Performance 82, Accessibility 100, Best Practices 100,
  SEO 100; FCP 3.0 s, LCP 3.8 s, TBT 120 ms and CLS 0.058 under mobile throttling.
- Cloudflare edge compression and caching are not represented by the local static-server score.

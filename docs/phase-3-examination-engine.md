# Phase 3 examination engine

The Worker is authoritative for paper selection, attempt deadlines, answer state
and scoring. A browser receives question text and four options before submission,
but never receives answer-key indexes, explanations or correctness.

## Attempt lifecycle

1. `GET /api/test-config` lists verified patterns and published-question readiness.
2. `POST /api/attempts` creates a D1 attempt and snapshots ordered questions and marks.
3. The response contains a signed, attempt-scoped bearer token. The token is stored
   only in the originating browser.
4. `PUT /api/attempts/:id/responses/:questionId` accepts monotonic client revisions.
   Delayed/stale writes are ignored. Failed writes remain in a browser recovery queue.
5. `POST /api/attempts/:id/submit` calculates the result from D1 answer keys.
   Repeated submission is idempotent and result rows are immutable.
6. `GET /api/attempts/:id/results` reveals answers and provenance only after the
   attempt reaches a terminal state.

Every read or mutation also compares the server clock with `expires_at`. The browser
shows a server-derived countdown and submits at zero; a late read or write forces
the same timeout path, so changing the visible timer cannot extend an attempt.

## Modes

- Standard: question counts, sections, duration and marking come from a verified pattern.
- Custom: filters published questions by subject, topic, difficulty, year and origin.
- Previous year: selects one verified official document for the requested year/shift.
- Diagnostic: round-robins published questions across official pattern subjects.

`ATTEMPT_SIGNING_SECRET` must be installed with `wrangler secret put` in preview and
production. It must not be added to `wrangler.jsonc`.

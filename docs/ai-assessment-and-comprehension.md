# AI assessment and comprehension gates

## Assessment lifecycle

The create route makes a pending attempt. The generation route uses the canonical D1 states
`pending`, `generating`, `verification_pending`, `verifying`, `rate_limited`, `retryable`, `ready`
and terminal `cancelled`, `expired` or `invalid`. Each request performs one bounded provider stage,
then releases its database lease. Start and expiry timestamps are finalized only after the complete
set is accepted.

An active lease returns `202` without starting another provider call. An expired lease can be
reclaimed after a Worker restart. Rate limits preserve the candidate snapshot and failed stage, so
the same attempt resumes generation or verification after cooldown. Ready attempts are idempotent.

Each exam has a typed, versioned prompt. Groq JSON is validated by Zod. Exact, stem and
option-order-independent SHA-256 fingerprints are stored. Normalised-token Jaccard similarity uses
a `0.78` rejection threshold. Checks cover the current batch, visitor history and recent global
generations. Only rejected items are regenerated, with a request-count-derived bounded round limit.

A separate verifier context checks each proposed answer and explanation with a minimum confidence
of `0.8`. Simple arithmetic is recalculated in code when requested. Answers and explanations stay
server-only until final submission.

## Cost and study controls

Generation has Turnstile support, visitor and global request limits, a global token limit, 25-second
timeouts, a D1 simultaneous-request lock and `AI_GENERATION_ENABLED`. Groq keys belong only in
Worker secrets or local `.dev.vars`.

To mark only unscored legacy AI attempts with valid candidate snapshots as retryable, run
`npm run ai:recover:remote`. The recovery SQL excludes completed/submitted attempts, scores and
immutable answer results.

## Provider batching and global throttle

- Generation is persisted in sequential batches of at most five questions. A successful batch is
  never regenerated after a later cooldown.
- Generation output is capped at 2,200 tokens for five questions and scales down for smaller
  batches. Verification is capped at 1,200 tokens.
- Deterministic schema, option and arithmetic checks run before one batched verification request.
  Only uncertain candidates are sent to the verification model.
- `ai_provider_gate` provides a D1-backed project-wide lease: at most one Groq request is active and
  requests are separated by at least 2.1 seconds across Worker isolates.
- `ai_provider_model_cooldowns` stores the real provider `Retry-After` deadline per model.
  Generation fallback order is the configured model, `llama-3.1-8b-instant`, then
  `openai/gpt-oss-20b`; cooling models are skipped.
- `attempt_generation_hashes` stores normalized question hashes in D1. Previous questions and
  visitor data are not resent in prompts.
- The client polls status without invoking generation. A completed stage schedules one bounded
  continuation using the server-provided retry interval.

```env
AI_GENERATION_BATCH_SIZE=5
AI_GENERATION_MAX_OUTPUT_TOKENS=2200
AI_VERIFICATION_MAX_OUTPUT_TOKENS=1200
AI_PROVIDER_MIN_INTERVAL_MS=2100
AI_CLIENT_RETRY_SECONDS=20
```

Direct study completion is invalid. Engagement unlocks but never completes a task. Only a 70%
server-scored comprehension check completes it. Retry questions exclude previous check IDs,
passing schedules 1, 3, 7 and 15-day revisions, and skipped tasks do not enter the denominator.

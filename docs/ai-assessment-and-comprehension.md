# AI assessment and comprehension gates

## Assessment lifecycle

The create route makes a pending attempt. The generation route persists preparing, generating,
deduplicating, verifying and ready stages. Start and expiry timestamps are finalized only after the
complete set is accepted.

Each exam has a typed, versioned prompt. Groq JSON is validated by Zod. Exact, stem and
option-order-independent SHA-256 fingerprints are stored. Normalised-token Jaccard similarity uses
a `0.78` rejection threshold. Checks cover the current batch, visitor history and recent global
generations. Only rejected items are regenerated, for at most four bounded rounds.

A separate verifier context checks each proposed answer and explanation with a minimum confidence
of `0.8`. Simple arithmetic is recalculated in code when requested. Answers and explanations stay
server-only until final submission.

## Cost and study controls

Generation has Turnstile support, visitor and global request limits, a global token limit, 25-second
timeouts, a D1 simultaneous-request lock and `AI_GENERATION_ENABLED`. Groq keys belong only in
Worker secrets or local `.dev.vars`.

Direct study completion is invalid. Engagement unlocks but never completes a task. Only a 70%
server-scored comprehension check completes it. Retry questions exclude previous check IDs,
passing schedules 1, 3, 7 and 15-day revisions, and skipped tasks do not enter the denominator.

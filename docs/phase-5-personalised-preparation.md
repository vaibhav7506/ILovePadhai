# Phase 5 — Personalised preparation, revision and grounded assistance

Phase 5 keeps the browser's anonymous visitor number as the only study identity. It never requests
or stores a name, email address, phone number or password.

## Evidence flow

Final server scoring updates `topic_mastery` and writes incorrect, skipped and marked questions to
the mistake notebook. A diagnostic attempt also creates an anonymous study profile when one does
not exist.

The daily plan is generated from:

- available daily minutes;
- the lowest measured mastery topic;
- due mistake revisions;
- periodic retention for a strong topic;
- an honest diagnostic baseline when no scored topic evidence exists.

Every generated item stores its rationale. The plan can be paused without deleting evidence.

## Spaced revision

The initial intervals are approximately 1, 3, 7, 15, 30, 60 and 90 days. Incorrect recall resets
to one day. Correct recall advances one interval, or two at confidence 4–5. Confident recall at a
long interval marks the item mastered. This is an ExamForge study aid, not an official examination
method.

## Verified feeds

Current affairs and calendar events remain unavailable publicly until their rows pass the required
publication or official-verification status. PYQ trends require at least 20 published verified
official questions for the selected examination and carry a historical-trend disclaimer.

## Optional Groq boundary

`GROQ_ENABLED` defaults to `off`. `GROQ_API_KEY` is read only by the Worker and must be configured
as a secret in deployed environments. The browser never receives it.

The doubt endpoint retrieves only a published question's verified explanation, approved note and
official source. It returns “insufficient verified material” when that grounding is absent. When
Groq is disabled, times out or fails, the endpoint returns the stored verified material instead.

Controls include per-minute, per-day and global daily KV allowances, Turnstile according to the
environment policy, an eight-second timeout, one-day response caching, a global kill switch, and
token/status logs that deliberately exclude prompts and answers.

Enable in an environment only after storing the secret:

```powershell
npx wrangler secret put GROQ_API_KEY --env production
```

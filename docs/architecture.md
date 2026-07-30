# Phase 1 architecture

The Vite-built React application and Hono API ship as one Cloudflare Worker. Workers Static
Assets serves the client, D1 is the relational source of truth, KV holds only a 60-second public
count and short rate-limit keys, and R2 is bound for future permitted source documents.

## Identity and footfalls

The browser creates a UUID with `crypto.randomUUID()`, stores it in localStorage, and mirrors it
in a first-party `SameSite=Lax` cookie. A session UUID lives in sessionStorage. D1 assigns the
public learner number through an `AUTOINCREMENT` primary key and enforces a unique UUID. An
`INSERT OR IGNORE` followed by the unique-row lookup makes concurrent repeat registrations
resolve to the same learner. Sessions, rather than learners, represent visits.

No full IP address or raw fingerprint is written. User agents are reduced to broad device
categories; referrers are reduced to direct/search/social/internal/referral without storing URLs.
Obvious crawler and monitoring agents are rejected before registration.

## Privacy and analytics

Page events are written only while anonymous analytics consent is enabled. The public APIs never
return a visitor UUID. Clearing browser storage or changing devices breaks access to the former
browser-linked history. The Phase 1 delete endpoint is implemented for later wiring to an
explicit, confirmed reset flow.

## Security

API payloads are validated with Zod. Queries are parameterized. Responses receive a restrictive
CSP, HSTS, frame denial, permissions policy and related headers. Visitor registration is
rate-limited using short-lived KV keys. Turnstile Siteverify runs only on the Worker, checks the
hostname and uses a Worker secret when enforcement is enabled.

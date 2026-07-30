# Phase 4 — Results, leaderboards, comparisons and cutoff readiness

Phase 4 extends the immutable Phase 3 attempt snapshot. It does not seed rankings or infer
qualification.

## Result evidence

The server computes marks, maximum marks, accuracy, correct/incorrect/skipped counts, time,
negative marks, and section/subject/topic/difficulty breakdowns. Strong and weak sections,
revision candidates, and time-management warnings are derived from these stored facts.

Per-question time is synchronized monotonically and included in the immutable score summary.

## Comparable leaderboards

Each attempt receives a SHA-256 comparison key over its examination, pattern, mode, tier, duration,
ordered question IDs, and marking values. Only legitimate attempts with the same key can share a
leaderboard.

- First is the immutable ordinal-one entry.
- Best sorts by score descending, accuracy descending, then completion time ascending.
- Latest selects the newest comparable entry per learner.
- Weekly considers the last seven days.
- All-time uses the best comparable entry.

Profiles are private by default. A learner may publish a filtered nickname; otherwise their real
visitor number is rendered as `Learner N`. Rank and percentile remain unavailable until at least 20
legitimate comparable learners exist.

## Integrity

Server-side submission checks flag impossible completion time, excessive answer mutations, and
missing comparison fingerprints. Flagged attempts remain visible to their learner but are excluded
from leaderboard entries. Result and leaderboard snapshots are protected by database triggers.

## Cutoff and readiness

Cutoffs require exact examination, stage, category, region, and post dimensions and only use
`verified_official` records. The output includes the latest matched cutoff, score difference,
historical range, years, and a ten-mark safer target buffer. It always states that historical
performance does not guarantee qualification.

Readiness is a transparent weighted indicator using available recent score rate (35%), accuracy
(25%), coverage (15%), consistency (15%), and exact cutoff margin (10% when available). Missing
components are not invented; weights are normalized over available evidence. Fewer than three
comparable attempts is marked provisional.

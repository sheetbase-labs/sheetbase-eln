# 0001. Record architectural decisions as numbered decision records

- **Status:** accepted
- **Date:** 2026-07-18
- **Ticket:** FND-002

## Context

The roadmap defers several durable contracts (block persistence granularity,
generated-table naming, formula trust boundaries, storage, signature
assurance) until their phase provides evidence. Without a written record, a
later developer can reverse such a contract without realising it was settled
deliberately.

## Decision

Durable architectural decisions are recorded as numbered files in
`docs/decisions/` using the format in that directory's README. A ticket that
settles a durable contract is not complete until its record exists.

## Consequences

- Reversals are explicit: a new record supersedes the old one.
- Decision history lives in the repository, reviewable with the code it
  describes.
- Small local choices stay undocumented; only durable contracts earn a
  record, keeping the log cheap to maintain.

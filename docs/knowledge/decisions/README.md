# Decision records

Short, durable records of architectural decisions a future developer might
otherwise reverse accidentally. `TODO.md` requires one whenever a ticket
settles a durable contract.

## Format

One file per decision: `NNNN-short-slug.md`, numbered sequentially
(`0001-…`, `0002-…`). Never renumber. Keep each record short — half a page is
plenty.

```markdown
# NNNN. Title

- **Status:** accepted | superseded by NNNN
- **Date:** YYYY-MM-DD
- **Ticket:** the TODO ticket that settled it

## Context

Why a decision was needed now. What forces conflicted.

## Decision

The choice, stated plainly.

## Consequences

What becomes easier, what becomes harder, what is now forbidden.
```

## Rules

- A decision record is written when the decision is made, alongside the code,
  not retrospectively.
- Reversing a decision means adding a new record that supersedes the old one.
  Do not edit history to look consistent.
- Record only durable contracts (data ownership, security boundaries,
  integration shapes). Local implementation taste does not need a record.

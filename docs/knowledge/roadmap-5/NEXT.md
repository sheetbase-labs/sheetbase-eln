---
title: Roadmap 5 — current work
status: proposed
last_reviewed: 2026-10-11
---

# Roadmap 5 — current work

**Implemented, not accepted.** All 21 tasks are implemented on
`GWP/roadmap-5-implementation` (PR #222), one commit per task; see the
[programme map](PROGRAMME_MAP.md#delivery-record) for the commits and the
verification record. Nothing here is an acceptance claim, and the corpus still
keeps no task queue: the repository-wide [NEXT.md](../NEXT.md) decides what is
worked next.

Unlike Roadmap 4, this corpus does **not** own a task queue. It has no nod
tracker and no generated checklist: [PROGRAMME_MAP.md](PROGRAMME_MAP.md) is its
only status table, and the repository-wide [NEXT.md](../NEXT.md) decides when a
stream is activated and by whom.

## Status

|                 |                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Tasks           | **21 implemented**, one commit each, on `GWP/roadmap-5-implementation` (PR #222)                     |
| Streams         | 6 — SURF, STUDIO, NOTE, HOME, CONFIG, SHELL                                                          |
| Audit           | app-3 UI-only working copy vs ELN `10a84a42`, 11 October 2026                                        |
| Verification    | `tsc` 0 errors; eslint 0 errors; 430 files / 4374 unit tests; 22 files / 192 database tests          |
| Acceptance      | **Not recorded.** Visual-parity and browser layers remain deferred; the success criteria are unmet   |
| Decisions taken | Four tasks needed an owner decision; each recorded the conservative option in its commit (see below) |

## Decisions taken during implementation

- **R5-STUDIO-01** — statistics were implemented with closed-form tests and the
  method recorded in the frozen analysis; the accepted decision was amended in
  ADR-0040 rather than inventing a new contract.
- **R5-SHELL-05** — sign-in stays GitHub SSO only: no credential store was
  built, the sign-in lockout state is deliberately absent and says so, and the
  only lock is the signing step-up lock.
- **R5-CONFIG-03** — MDL-03 confirms approval is in the accepted model, so the
  task was not reduced; the draft lock under review was preserved rather than
  widened.
- **R5-SHELL-01** — the hand-maintained v3 allow-list became a recorded
  denylist of four internal reference routes.

Each is reversible and recorded where it applies; none changes a permission
model.

## What is left

Nothing in this corpus is in progress. What remains is acceptance, not
implementation: the corpus's own success criteria, the deferred visual and
browser layers, and the DSYS-06 parity gap that predates this programme.

## Standing constraints

- Task completion in this corpus is not release acceptance; Roadmap 4's
  reconciliation limits still stand, and the visual and browser layers remain
  deferred acceptance work.
- Hosted CI has never executed on this repository (PLAT-03). Never cite hosted
  checks as evidence, in either direction.
- The interface reference is an unversioned working copy: re-read it at the time
  of the work, and never copy its fixture data or `?state=` QA affordances into
  the product.

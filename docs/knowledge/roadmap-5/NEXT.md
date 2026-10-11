---
title: Roadmap 5 — current work
status: proposed
last_reviewed: 2026-10-11
---

# Roadmap 5 — current work

**Proposed; not activated.** Nothing is in progress and no task is assigned.
This corpus records the app-3 interface gap and the work to close it; see
[README.md](README.md) and the evidence in [FINDINGS.md](FINDINGS.md).

Unlike Roadmap 4, this corpus does **not** own a task queue. It has no nod
tracker and no generated checklist: [PROGRAMME_MAP.md](PROGRAMME_MAP.md) is its
only status table, and the repository-wide [NEXT.md](../NEXT.md) decides when a
stream is activated and by whom.

## Status

|                   |                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Tasks             | 21 proposed, 0 in progress, 0 done                                                                                     |
| Streams           | 6 — SURF, STUDIO, NOTE, HOME, CONFIG, SHELL                                                                            |
| Audit             | app-3 UI-only working copy vs ELN `10a84a42`, 11 October 2026                                                          |
| Blocking decision | None to start Wave A. STUDIO-01 and SHELL-05 need decisions; CONFIG-03 and NOTE-02 need an existing contract confirmed |

## Ready to start (Wave A, no prerequisite)

1. **R5-SURF-03** — mount the ported `NotFound` and fix its dead `_app` route
   ids. Smallest task in the corpus and user-visible today.
2. **R5-SURF-01** — dataset Imports, Used by and History tabs over
   `dataset_imports` and `change_events`/`ObjectHistoryTimeline`.
3. **R5-SURF-02** — project-scoped Datasets, Samples and Experiments.
4. **R5-SHELL-03** — give `src/lib/capabilities.ts` real keys, a roadmap map and
   honest gap states.

## Waiting on a decision

- **R5-STUDIO-01** — which statistical models are in scope, and with what
  authority the results are presented (the interface shows one-way ANOVA with
  assumption checks; the ELN currently offers descriptive statistics and
  polynomial regression only). Extend the existing analysis definition rather
  than adding a second one.
- **R5-SHELL-05** — whether the product offers a password or step-up re-auth
  path at all, or records that GitHub SSO is the only sign-in.
- **R5-CONFIG-03** — whether model publication gains an approval step, which
  interacts with MDL-03's accepted publication decision.
- **R5-NOTE-02** — confirm the REV-03 signing contract before adding a generic
  e-signature dialog and notebook signature blocks.

## Order after Wave A

Wave B (studio and quiet home), then Wave C (notebook, configuration), then
Wave D (shell, theme, search, sign-in). Rationale and exits are in
[PROGRAMME_MAP.md](PROGRAMME_MAP.md#delivery-sequence).

## Standing constraints

- Task completion in this corpus is not release acceptance; Roadmap 4's
  reconciliation limits still stand, and the visual and browser layers remain
  deferred acceptance work.
- Hosted CI has never executed on this repository (PLAT-03). Never cite hosted
  checks as evidence, in either direction.
- The interface reference is an unversioned working copy: re-read it at the time
  of the work, and never copy its fixture data or `?state=` QA affordances into
  the product.

---
id: task-33
title: DSYS-05 — Design-data seed
type: task
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-10-08"
parent: epic-14
related:
  - task-2
tags:
  - DSYS-05
  - DSYS
  - wave-A
---

# DSYS-05 — Design-data seed

Spec: [DSYS-05 in tasks/DSYS.md](../../tasks/DSYS.md#dsys-05--design-data-seed)

- Stream: DSYS (epic-14)
- Wave: A
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
  - 2026-10-10: ExperimentsList analysed and left for a decision. Measured in process-development: 160 non-deleted experiments = 39 design-declared + 121 padding. Declared: draft 14, approved 11, in_progress 8, in_review 4, on_hold 1, planned 1. Padding: in_progress 77, approved 28, in_review 16. The canvas states All 148 with In progress 12, In review 4, Approved 97, Drafts 3 under an active 'Updated in last 30 days' filter chip (or as totals if that chip is decorative). Either reading conflicts with the declared rows: the seed declares 14 draft experiments where the canvas shows 3, so no padding-only reassignment can reach the canvas (an attempt fails fast with 'cannot reach 12 in_progress rows' once the surplus is parked outside the window). Resolving it means deciding whether those declared drafts belong on this board at all, or whether the canvas's Drafts figure is the one that moves - both are cross-board product questions, so the step was reverted rather than forced. The seed still runs clean (44 steps).
  - 2026-10-10: cause-3 worked examples, measured against the dev database (process-development workspace). The parity gate compares the whole screen at a 0.001 tolerance, so the canvas aggregates must match, not just the displayed rows. DatasetsList: canvas says All 311 / Mine 64 / Has issues 2 / Locked 188 and the seed creates 11 datasets (the ten named rows plus DS-0320) - the named rows match, the aggregates do not. ExperimentsList: canvas says All 148 / Mine 31 / In progress 12 / In review 4 / Approved 97 / Drafts 3 and the seed creates 160 experiments with a different status split. Projects was the opposite case (seed 24 active matches All 24) and fails only on the canvas inspector width. So the DSYS-05 seed work needs a per-screen-group generator that reproduces each canvas's counts and status distribution, and the boards have to be reconciled one canvas at a time against the tokens.
  - 2026-10-10: parity failure causes tallied from tests/visual/design-states.ts. Of the 44 mapped screens, 35 name cause 3 (seeded content: the screen does not show the rows/fields the design screen shows). Causes 1, 2 and 4 are recorded as resolved in the annotations. So the remaining DSYS-06 board failures are dominated by this seed gap, not by chrome, typography or route resolution: finish the per-screen-group seed content before touching layout or tolerances.
- 2026-09-27: Seeded the design projects (design seed): 8 PRJ projects across the four workspaces, idempotent (db:seed:design converges). Custom fields await the PROJ-01 columns; the projects.custom_fields trigger rejects unregistered keys.
- 2026-09-28: PR #206: the design seed now carries the Projects screen's clients (CL-009/011/014/017/022), the 12 visible projects with the design's PRJ ids, clients, stages, leads and statuses, 12 archived projects, and 148 experiments redistributed across projects to reach the exact counts.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/db/seed/design.ts; tests/visual/design-states.ts:158; scripts/design-seed-coverage.mts:25. Remaining: Populated seed has expanded, but DESIGN_STATES is empty. Coverage scans selected ID families rather than all specified values and does not fail on misses. Complete state mapping, coverage enforcement and idempotent real-service proof. See docs/knowledge/roadmap-4/RECONCILIATION.md#dsys-05. Source audit, not fresh service/browser acceptance.
- 2026-10-03: DSYS-05.4 done: the coverage script now gates (non-zero on a missing required family/value; 461/605 -> 517/605 matched). Seed now covers working sheets, review/signature lifecycle, folders/files, pipeline runs, connectors/tokens and the client portal. 05.2/05.3 (per-screen groups and the state driver for empty/error/loading/offline/conflict) remain; waiting pipeline runs are blocked on the waiting-status schema (COMP/PIPE-02).
- 2026-10-04: PR #220 pipeline seed correction: only PL-0014 latest run failed; PR-01 fresh success or canonical linked retry of recognised old seed failure. Original pins/history retained, unrelated failures not recovered. Integrated DB seed/domain 38 tests pass; 43-step populated seed twice leaves all pipeline rows unchanged; real latest-run query and DOM show 1 failed. HelpRecords both-theme parity + navigation 6 tests pass. Full design coverage remains open.
- 2026-10-04: Dedicated owner assigned full original126-screen seed/zero-unmatched/idempotence exit; coordinates measured values with DSYS-06. Preserve0315 native fixture credential/session/independent verifier/real step-up authority. No fabricated evidence or direct grants.
- 2026-10-08: Coordinator (local): design seed completes end to end (43 steps) and reseeds idempotently after seeding the Settings Access project matrix and groups. Analysis citation unblocked by accepted 0326. Six DSYS/EXP/schema DB suites pass 17 tests; identifier gate at 595/971 matched. Remaining: all-values coverage, historical clock/actor authority, parity.

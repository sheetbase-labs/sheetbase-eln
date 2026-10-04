---
id: task-33
title: DSYS-05 — Design-data seed
type: task
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-10-04"
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
- 2026-09-27: Seeded the design projects (design seed): 8 PRJ projects across the four workspaces, idempotent (db:seed:design converges). Custom fields await the PROJ-01 columns; the projects.custom_fields trigger rejects unregistered keys.
- 2026-09-28: PR #206: the design seed now carries the Projects screen's clients (CL-009/011/014/017/022), the 12 visible projects with the design's PRJ ids, clients, stages, leads and statuses, 12 archived projects, and 148 experiments redistributed across projects to reach the exact counts.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/db/seed/design.ts; tests/visual/design-states.ts:158; scripts/design-seed-coverage.mts:25. Remaining: Populated seed has expanded, but DESIGN_STATES is empty. Coverage scans selected ID families rather than all specified values and does not fail on misses. Complete state mapping, coverage enforcement and idempotent real-service proof. See docs/knowledge/roadmap-4/RECONCILIATION.md#dsys-05. Source audit, not fresh service/browser acceptance.
- 2026-10-03: DSYS-05.4 done: the coverage script now gates (non-zero on a missing required family/value; 461/605 -> 517/605 matched). Seed now covers working sheets, review/signature lifecycle, folders/files, pipeline runs, connectors/tokens and the client portal. 05.2/05.3 (per-screen groups and the state driver for empty/error/loading/offline/conflict) remain; waiting pipeline runs are blocked on the waiting-status schema (COMP/PIPE-02).
- 2026-10-04: PR #220 pipeline seed correction: only PL-0014 latest run failed; PR-01 fresh success or canonical linked retry of recognised old seed failure. Original pins/history retained, unrelated failures not recovered. Integrated DB seed/domain 38 tests pass; 43-step populated seed twice leaves all pipeline rows unchanged; real latest-run query and DOM show 1 failed. HelpRecords both-theme parity + navigation 6 tests pass. Full design coverage remains open.
- 2026-10-04: Dedicated owner assigned full original126-screen seed/zero-unmatched/idempotence exit; coordinates measured values with DSYS-06. Preserve0315 native fixture credential/session/independent verifier/real step-up authority. No fabricated evidence or direct grants.

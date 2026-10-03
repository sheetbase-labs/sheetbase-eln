---
title: Agent goal — complete Roadmap 4
status: active
owner: implementation agent
created: 2026-10-03
---

# Agent goal — complete every active Roadmap 4 exit

## Objective

Implement and accept **every active Roadmap 4 task** in
`docs/knowledge/roadmap-4/tasks/` — all 85 active tasks (86 original less the
cancelled SHELL-04) — following the existing architecture (DB-first per
capability) and the original task exits. Do not move requirements to Roadmap 5,
do not close a task whose exit is unmet, and do not create duplicate engines.

Authority and rules: `/tmp/finish-roadmap-4-handoff.md`,
[RECONCILIATION.md](RECONCILIATION.md) and the repo `AGENTS.md`.

## Definition of done (programme)

1. Every active task and step is `done` in nod with implementation + acceptance
   evidence (contract test → migration/RLS/RPC → data module → screen where the
   task requires a screen).
2. The four inherited completions (DSYS-01/02/04, SHELL-05) have fresh acceptance.
3. DSYS-05/06 visual gates are real: a populated design seed, a non-empty
   state mapping, and a parity loop that fails on intentional drift.
4. The programme workflow is demonstrated end to end on populated data:
   project/experiment setup → scientific entry/import → composed Sheet work →
   analysis → submission → review/signing → frozen reconstruction.
5. `pnpm validate`, `pnpm test:db`, `pnpm test:api` and the browser suites pass
   (or each failure is an explicit, recorded blocker owned by a decision).

Local completion is separate from merge/deploy. The owner has authorized
pushing to the PR for this work: **PR #220**
(https://github.com/sheetbase-labs/sheetbase-eln/pull/220), base
`roadmap-4/ui-app3` (stacked on #207 → #206 → #205 → #204 → #203 → #189 →
`main`). Keep committing and pushing to `GWP/roadmap-4-shell`; merging still
needs explicit approval and green CI.

## Working method

- One bounded, dependency-aware slice at a time; each slice is a reviewable
  commit with tests and, where relevant, browser acceptance.
- DB-first: contract test (success / denied / other workspace / stale) →
  migration + RLS + RPC → data module → screen.
- After any migration: `pnpm db:migrate` on the dev DB before browser suites.
- Keep nod current (`pnpm roadmap note/update`, `pnpm roadmap:sync`,
  `pnpm roadmap:check`); commit the generated `CHECKLIST.md`/`NEXT.md`.
- Preserve the concurrent agent's uncommitted reconciliation docs.
- Persist a checkpoint every session (see `/tmp/roadmap-4-checkpoint-*.md`).
- Delegate independent bounded slices to subagents when files do not overlap;
  serialize shared migrations and tracker changes.

## Ordered workstreams (from the handoff execution order)

1. **Acceptance + shell:** DSYS-05/06, SHELL-01/02/03. _(DSYS-05.4/06.2 and
   SHELL-01.2 need owner decisions — design states, role→nav map.)_
2. **Scientific correctness:** DSET-01/03/04, LAB-03, MOB-02, LAB-07.
   _(DSET-01.1's `missing_unit`/`above_curve`/`high_cv` need a rule-config
   decision.)_
3. **Shared contracts + scientific workflows:** COMP-01–07, SHEET-01–05,
   MDL-01–04. _(MDL-02.1 routes and MDL-02.3 field editor remain.)_
4. **Projects, experiments, import, lab, settings:** PROJ, EXP, DSET-05/06,
   LAB, SET.
5. **Governed + automation:** REV, PORTAL, PIPE.
6. **Mobile, offline, templates, programme exits:** MOB, EXP-05, SHEET-04,
   final populated-workflow proof.

## Progress log

- 2026-10-03: MDL-04 (all 3 steps) implemented, accepted and committed
  (`0c6754af`, `6c11aefb`); client `node:zlib` regression fixed; design Cell
  bank seeded; prettier cleanup (`66f068dc`). Tracker 28/85. MDL-02 found
  `in-progress` (02.1, 02.3 remain) despite the earlier handoff.
- 2026-10-03: PR #220 opened on `roadmap-4/ui-app3`; branch pushed. Two
  background subagents launched on disjoint slices: Relations for workspace
  models (migration 0292 + DB test + route) and SHELL-01.2 permission-aware
  navigation (unit tests). `api.discover_model_dependencies` extended for
  workspace models (`0291`, `4e69f5b6`).
- 2026-10-03: MDL-02.1 partial — Rules and Usage tabs for workspace record
  models (`e2f1dea3`), screens 102x2, models area green. Recorded blockers in
  nod `subtask-257`:
  - **Relations route blocked:** `api.model_relationship_rules.source_model_key`
    references `api.model_kinds` only, so a workspace record model cannot be a
    relationship source. Needs a schema/domain decision (extend to
    `record_models` or keep relations built-in-only).
  - **Frame split:** the dataset-schema (uuid) frame has no rules/relations/
    usage tabs, and `model_rules` does not read `dataset_schema_version_fields`.
    Decide whether the design's model editor is the ADR-0051 record-model frame
    (likely) and port accordingly.
  - **Impact discovery:** `api.discover_model_dependencies` resolves
    `model_kinds` only and 403s on a workspace model key. Extend it to
    `record_models` (host `api.records`, kind = key) to complete the Usage tab
    and MDL-01's "works like built-in kinds" exit.

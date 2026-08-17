# Prompt — PC Product Consolidation

Work on the **assigned PC stream** in `phlohouse/sheetbase-eln`. Read `docs/roadmap/NEXT.md` first and implement only that PC task.

## Start

- Branch from current `main` unless `NEXT.md` says otherwise.
- Verify exact HEAD.
- Read `docs/roadmap/tasks/PC.md`, `docs/roadmap/audits/PC-00.md` (accepted decisions), relevant Core evidence and ADRs.
- Do not implement API-01, DATA-01, GOV-01 or PLAT-03 in a PC session.

## Current assigned task (when NEXT.md says PC-01)

**PC-01 — Canonical Sheet Experience (Medium).**

Include only:

- canonical Sheet experience (one grid stack; existing CORE-03/H2 RPCs);
- blank experiment/Notebook create;
- submit through the existing revision/evidence contract;
- demote specialist tools from default navigation (do not delete routes).

Do **not** broaden into full PC-03. Do **not** make `viewer` read-only.

## Product objective

Turn the completed Core into one coherent scientist-facing product. Scientists should not need to understand Dataset/Definition/Instance persistence architecture to work naturally.

Preserve these principles:

- one canonical Sheet experience spanning ad-hoc and composed states;
- Dataset binding is distinct from schema promotion;
- local and governed data can coexist;
- Notebook is scientific context; Sheet is structured work;
- reusable Definitions/Templates do not imply shared live state;
- PostgreSQL/RLS/server validation remain authoritative;
- dense, keyboard-efficient, accessible UX;
- legacy/duplicate surfaces do not regain primary status;
- specialist tools stay secondary during consolidation.

## Working method

1. inspect current routes/components/RPCs/tests before editing;
2. map user actions to existing Core contracts;
3. identify missing product seams rather than inventing parallel domain models;
4. implement production code, migrations if genuinely needed, tests and docs together;
5. exercise realistic scientist/steward workflows;
6. run focused validation, then the task-defined final gate;
7. make reviewable commits with no agent/vendor attribution.

## Scope guard

Do not start Pipelines/AUTO. Do not create another Dataset, Sheet, Template, schema or capability system. Do not redesign settled Core architecture without concrete defect evidence.

## Completion

Update roadmap task evidence and `NEXT.md` only when the assigned PC task's exit criteria are genuinely met. Report user-visible outcome, contracts reused, tests, remaining risks and next hand-off for this stream.

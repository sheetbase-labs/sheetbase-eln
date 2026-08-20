# Prompt — PC Product Consolidation

Work on the **assigned PC stream** in `phlohouse/sheetbase-eln`. Read `docs/roadmap/NEXT.md` first and implement only that PC task.

## Start

- Branch from current `main` unless `NEXT.md` says otherwise.
- Verify exact HEAD.
- Read `docs/roadmap/tasks/PC.md`, `docs/roadmap/audits/PC-00.md` (accepted decisions), relevant Core evidence and ADRs.
- Do not implement API-02, DATA-01, GOV-02 or remaining PLAT-03 in a PC session unless that is the assigned stream.

## Current state

**PC-01 through PC-04 are complete on `main`.** Do not reopen them. **PC-05 is ready to merge as `#54`; PC-06 Golden Workflow Consolidation is assigned on `GWP/pc-06-golden-workflows` and stacked on that PR. Merge PC-05 before PC-06.**

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

# Prompt — PC Product Consolidation

Work on the active **PC — Product Consolidation** epic in `phlohouse/sheetbase-eln`.

## Start

- Branch from current `main` unless `docs/roadmap/NEXT.md` says otherwise.
- Verify exact HEAD and read `NEXT.md` first.
- Read `docs/roadmap/tasks/PC.md`, the PC-00 audit, relevant Core task/evidence docs and ADRs.
- Implement only the active PC epic identified by `NEXT.md`; do not opportunistically implement later PC epics.

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
- legacy/duplicate surfaces do not regain primary status.

## Working method

For the active epic:

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

Update roadmap task evidence and `NEXT.md` only when the active epic's exit criteria are genuinely met. Report user-visible outcome, contracts reused, tests, remaining risks and next hand-off.

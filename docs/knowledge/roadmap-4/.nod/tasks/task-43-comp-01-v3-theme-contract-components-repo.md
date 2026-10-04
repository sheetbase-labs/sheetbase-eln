---
id: task-43
title: COMP-01 — v3 theme contract (components repo)
type: task
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-03"
parent: epic-42
related:
  - task-2
tags:
  - COMP-01
  - COMP
  - wave-A
---

# COMP-01 — v3 theme contract (components repo)

Spec: [COMP-01 in tasks/COMP.md](../../tasks/COMP.md#comp-01--v3-theme-contract-components-repo)

- Stream: COMP (epic-42)
- Wave: A
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
- 2026-09-27: COMP-01 complete in sheetbase-components (roadmap-4/comp): theme.css variables, v3.css preset, table/explorer literals replaced, check-colour-literals wired into lint.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: ../sheetbase-components/packages/shared/src/themes/v3.css:10-47 — v3 variable preset exists; ../sheetbase-components/packages/table/src/ui/TableSurface.tsx:90-91,135 — literal palette/default colours remain; ../sheetbase-components/packages/table/src/ui/Spreadsheet.tsx:2123 — literal reference colours remain; ../sheetbase-components/scripts/check-colour-literals.ts:12-15 — lint only scans CSS; task explicitly includes TSX. Remaining: 1: shared variables/preset exist; exhaustive token equality/default-look acceptance unverified. 2: replace remaining TSX literals. 3: add documented host variable mapping in shared README and verify exact token parity. 4: include CSS/TSX outside theme exceptions in lint. Existing done claim is contradicted for literal replacement and lint scope. See docs/knowledge/roadmap-4/RECONCILIATION.md#comp-01. Source audit, not fresh service/browser acceptance.
- 2026-10-03: COMP-01 complete on the components branch: lint now covers package TS/TSX/CSS, remaining literals moved to theme variables, v3.css equals tokens.json, host mapping documented in packages/shared/README.md. sheetbase-components roadmap-4/comp 0b7ce5e.

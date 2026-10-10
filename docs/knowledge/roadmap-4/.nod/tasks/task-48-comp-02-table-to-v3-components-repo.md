---
id: task-48
title: COMP-02 — Table to v3 (components repo)
type: task
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-03"
parent: epic-42
related:
  - task-2
  - task-43
tags:
  - COMP-02
  - COMP
  - wave-A
---

# COMP-02 — Table to v3 (components repo)

Spec: [COMP-02 in tasks/COMP.md](../../tasks/COMP.md#comp-02--table-to-v3-components-repo)

- Stream: COMP (epic-42)
- Wave: A
- Waits on: DEC-01 (task-2), COMP-01 (task-43)
- Steps: 6 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: ../sheetbase-components/packages/table/src/ui/Spreadsheet.tsx:215-226 — configurable dimensions and columnGroups; ../sheetbase-components/packages/table/src/ui/Spreadsheet.tsx:411-414 — dimensions used; ../sheetbase-components/packages/table/src/ui/TableSections.tsx:1 — current sections exports; no notebookTableSections; ../sheetbase-components/packages/table/e2e/specs — no v3-grids.spec.ts fixture. Remaining: 1 dimension props implemented; v3 preset consuming 28px still needs proof. 2 column groups exist but full source badges incomplete. 3 specified cellState contract absent. 4 append/draft-row design and notebook preset not complete. 5 v3 one-tab-stop behaviour unverified. 6 v3 crop fixtures absent. See docs/knowledge/roadmap-4/RECONCILIATION.md#comp-02. Source audit, not fresh service/browser acceptance.
- 2026-10-02: 2026-10-02 dependency reconciliation: added existing specification/programme-map gates COMP-01. Other partial implementation can continue; these are full-task acceptance dependencies.
- 2026-10-03: COMP-02.3/02.4/02.5 done (components 859106d). Gaps found in 02.1: v3 28px row height not wired (JS number, v3.css --row-height unread) and base.css gridline background hardcodes 31px; 02.2: per-column source label + Source badge and the fx computed mark missing. 02.6 fixtures remain.
- 2026-10-03: COMP-02.1 and 02.2 complete (components 8a08c09): v3 row height now read from --row-height (28px) and the per-column source badge + fx mark added. 02.6 fixtures: chart-independent grid fixture exists at packages/table/e2e/specs/v3-grids.spec.ts but is an annotated expected-failure (headers render --accent-soft where the design is surface-muted); the other 12 design grids are not yet fixtured.
- 2026-10-03: 02.6 progress: the SheetWorking grid fixture now passes at 0.46% (light) / 0.46% (dark) after routing the grid surfaces through v3 tokens (06d1205). The other 12 design grids in the step (Notebook block, NbEditing, NbConflict, NbOffline, NbViewer, SheetPromote, DatasetExplorer, ExpDatasets, ReviewRecord, ImportMap, ModelRecords, TemplateEditor) are not yet fixtured.
- 2026-10-03: COMP-02 complete: cell states, append row, keyboard model, v3 row height and source badge, and fixtures for all thirteen design grids (26 comparisons, 0.03-1.47% pixel difference, light and dark) at components 8ee4792.
- 2026-10-03: All steps done; closed by roadmap sync.

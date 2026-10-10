---
id: task-69
title: COMP-06 — Replace Handsontable
type: task
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-03"
parent: epic-42
related:
  - task-2
  - task-3
  - task-48
  - task-65
tags:
  - COMP-06
  - COMP
  - wave-B
---

# COMP-06 — Replace Handsontable

Spec: [COMP-06 in tasks/COMP.md](../../tasks/COMP.md#comp-06--replace-handsontable)

- Stream: COMP (epic-42)
- Wave: B
- Waits on: DEC-01 (task-2), DEC-02 (task-3), COMP-02 (task-48), COMP-05 (task-65)
- Steps: 5 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): not-started. Evidence: src/components/sheet/sheetbase-grid.tsx:1-2 — public wrapper remains Handsontable-specific; src/components/sheet/sheetbase-grid-client.tsx:1-6 — HotTable backend; src/lib/formula-write.server.ts:7,161 — HyperFormula authority; package.json:84,119-120 — dependencies retained; docs/knowledge/decisions/0048-sheet-grid-on-sheetbase-table.md:24-35 — accepted authority contract. Remaining: All five implementation steps remain: neutral wrapper, package backend across surfaces, editors, accepted single-engine compatibility migration, dependency/license/CSS removal. Existing grid remains working baseline; no claim of regression. See docs/knowledge/roadmap-4/RECONCILIATION.md#comp-06. Source audit, not fresh service/browser acceptance.
- 2026-10-02: 2026-10-02 dependency reconciliation: added existing specification/programme-map gates COMP-02, COMP-05. Other partial implementation can continue; these are full-task acceptance dependencies.
- 2026-10-03: COMP-06.1 complete: vendor-neutral SheetbaseGridProps with both callers adapted, Handsontable still underneath. Steps 2-5 (package backend, editor hooks, formula authority, dependency removal) need the packages published to GitHub Packages and the ADR-0048 engine parity work.
- 2026-10-03: COMP-06.2 partial: a sheetbase-table adapter now backs the ad-hoc sheet behind an opt-in VITE_SHEETBASE_TABLE_GRID flag (e0dcf088). Blocked from default-on by package gaps: no pre-commit mutation veto (fail-closed write guard), no clipboard before-hooks, no header-menu hook, no editor hooks (record picker), no sort/filter surface. Canonical and notebook surfaces untouched.
- 2026-10-03: Package side unblocked at components 7809b73 (released 0.2.0): beforeCellsChange pre-commit veto, clipboard before-hooks + cut status, header menu entries, column-targeted custom editors with the stored value, stored-value/display-text split, and sort/filter notifications.
- 2026-10-03: Package side for the ad-hoc surface closed at components 0.4.0: boolean checkbox cells, view-level local sort/filter for identity-keyed bound grids, and a whole-operation bulk-write veto. Formula parity (ADR-0048: 18 statistical functions, compiled SUBSTITUTE/FILTER, TIMEVALUE, boolean/date/error/TEXT/spill semantics, 34-case parity suite) shipped in 0.3.0. ELN side remaining: canonical + notebook surfaces, editor hooks, formula-authority migration, Handsontable removal.
- 2026-10-03: COMP-06.2: canonical and ad-hoc surfaces now render on sheetbase-table by default (3cacbe7e); the notebook sheet block still uses Handsontable. Package gaps remaining for full parity: cell context menu + clipboard/clear actions, sparse per-column width restore, wider filter operators.
- 2026-10-03: COMP-06.4 done: the server formula authority runs on the sheetbase-table engine and HyperFormula is gone from the ELN and the grid; persisted profile ids/fingerprint preserved; 60 phase4 vitest tests pass. Remaining COMP-06: 06.2 notebook-block hooks (row-deletion preflight, column order, height/stretch), 06.3 editors, 06.5 dependency removal.
- 2026-10-03: All steps done; closed by roadmap sync.

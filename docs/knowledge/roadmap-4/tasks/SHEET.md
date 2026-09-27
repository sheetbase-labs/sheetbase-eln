# SHEET — Working Sheets, Templates and Analysis

**Status (2026-09-27):** Proposed; not assigned.

## Programme goal

Keep exploratory work easy and honest: a working sheet shows where every
column comes from, local work is promoted deliberately, templates never change
existing work, and analyses say when their inputs have moved.

## Baseline at `main` `9538f36`

- Sheet instances (`/sheets/$instanceId`) compose datasets, model records,
  local and calculated columns (CORE-03, GRID); canonical, composed and ad-hoc
  sheet workspaces; HyperFormula calculations.
- Schema evolution preview and apply (`schema-evolution.ts`, MODEL-04).
- Notebook templates and sheet definitions with versions and upgrade forms
  (`stewardship/`, REUSE).
- Analysis definitions with versions (`analysis_definitions`, ADR-0040);
  chart specification (ADR-0029); visualisation is single-dataset (NEXT.md
  known limit).
- Sheet-cell and range comment anchors are not implemented (NEXT.md).

## SHEET-01 — Working sheet surface

**Status:** proposed.

### Design

`canvas/SheetWorking.dc.html`, `canvas/SheetEmpty.dc.html`, `canvas/SheetTablet.dc.html`,
`design-system/components/Source/README.md`, `SheetGrid/README.md`.

### Scope

Source legend and per-column `Source` badges (dataset snapshot, linked record,
calculated, local); dataset columns pinned to a named snapshot and read-only
with "Update to latest snapshot"; "Add rows from a dataset"; column inspector
("where it lives"); empty-sheet start options (from snapshot, template, paste
or import, blank); "Add to notebook".

### Exit

Every column's source is visible in its header and inspector; updating the
pinned snapshot is an explicit, audited action.

## SHEET-02 — Promote local columns

**Status:** proposed; approval depends on MDL-03.

### Design

`canvas/SheetPromote.dc.html`, `canvas/PromoteRejected.dc.html`.

### Scope

Select local columns; choose target (existing dataset with a new model version,
or a new dataset and model); define field type and unit per column; creates a
draft model version sent for approval; on approval values are written as a new
snapshot with the sheet as source and the columns switch from local to dataset;
on return, the reviewer's reason is shown with "Edit and resubmit" or "Keep
local", and nothing in the dataset changes.

### Exit

A promotion never writes dataset values before approval (database test); a
returned promotion leaves the sheet and dataset unchanged.

## SHEET-03 — Sheet-cell and range comments

**Status:** proposed; closes the NEXT.md collaboration gap.

### Design

Row comments in the `canvas/Notebook.dc.html` inspector; `canvas/ReviewRecord.dc.html`
(comments on a changed cell); ⌥⌘M in `canvas/Shortcuts.dc.html`.

### Scope

Comment anchors on canonical sheet cells, rows and ranges, stable across row
reordering and schema versions; visible marker in the grid; thread in the
inspector; included in review and search (SRCH-01).

### Exit

A comment on a cell survives sort, filter, row insertion and a model version
upgrade, and is listed in the record's comment tab.

## SHEET-04 — Templates

**Status:** proposed; largely restyling existing REUSE capability.

### Design

`canvas/TemplatesList.dc.html`, `canvas/TemplateEditor.dc.html`,
`canvas/TemplateUpdate.dc.html`; template banner in `canvas/Notebook.dc.html`.

### Scope

Templates list across kinds (notebook, sheet, record) with version, status,
built-on, in-use counts; editor with sections, sheet column definitions
(source, type, unit, required, rule), placeholder text, changes since the last
version and publish impact; per-notebook update view listing what the new
version would add or change, with Apply recorded as a template update.

### Exit

Publishing a version changes no existing notebook; owners are told and choose;
signed notebooks cannot be updated; REUSE-02 baseline failure is fixed first.

## SHEET-05 — Analysis workspace

**Status:** proposed; lifts the single-dataset visualisation limit.

### Design

`canvas/Analysis.dc.html`, `canvas/AnalysisEmpty.dc.html`, `canvas/ExpResults.dc.html`,
`design-system/components/Chart/README.md`.

### Scope

- Sources: a sheet or dataset plus joined sources (join key, match report).
- Fields panel with roles (x, y, y2, series); calculated fields.
- Several charts per analysis with shared axes; reference lines with units;
  flagged points hollow and excluded from criteria with the reason.
- Data, Diagnostics (join matches, exclusions, unit consistency, replicates),
  and Versions tabs; stale detection when an input changes; re-run; save as a
  new version; embedded figures keep the version they cite.
- Results tab outputs (figures, tables, decision) with provenance.
- Empty and no-rows states.

### Exit

The seeded AN-0057 reproduces both charts and the diagnostics in the design;
an edit to a source row marks the analysis stale and signed records keep the
cited version.

# SHEET — Working Sheets, Templates and Analysis

**Status (2026-10-02):** Reconciled against `9bbd305c`; see [task evidence](../RECONCILIATION.md#sheet) and [live tracker](../CHECKLIST.md). Baseline sections describe the original planning snapshot, not current absence.

**Original scope note (2026-09-27):** Original proposal. Current status is reconciled below.

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

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#sheet-01).

**Original decision/dependency note:** Original proposal.

### Design

`canvas/SheetWorking.dc.html`, `canvas/SheetEmpty.dc.html`, `canvas/SheetTablet.dc.html`,
`design-system/components/Source/README.md`, `SheetGrid/README.md`.

### Scope

Source legend and per-column `Source` badges (dataset snapshot, linked record,
calculated, local); dataset columns pinned to a named snapshot and read-only
with "Update to latest snapshot"; "Add rows from a dataset"; column inspector
("where it lives"); empty-sheet start options (from snapshot, template, paste
or import, blank); "Add to notebook".

### Start here

- Route `src/routes/sheets/$instanceId.tsx` (132 lines) delegating to
  `src/components/sheet/composed-sheet-workspace.tsx`,
  `canonical-sheet-workspace.tsx`, `ad-hoc-sheet-workspace.tsx`.
- Column provenance: `src/lib/composed-sheet-grid.ts`, `canonical-sheet-grid.ts`,
  `src/lib/sheet-presentation-view.ts`. Composed sheets read datasets live;
  there is no pinned dataset version today.
- RPCs: `api.create_sheet_instance*`, `api.mutate_sheet_instance_local_state`,
  `api.materialize_sheet_instance`.

### Steps (PRs)

1. **Pinning.** Store the dataset version per dataset source on the sheet
   instance; reads use the pinned version (`query_dataset_version_rows`);
   RPC `update_sheet_source_version` (explicit, audited). DB tests.
2. **Header and legend.** Column source metadata (dataset + snapshot, record
   model, calculated, local) exposed to the grid (COMP-02 header groups and
   `Source` badges); legend row; column inspector "where it lives".
3. **Empty sheet** start options (`SheetEmpty`) using existing create RPCs.
4. "Add rows from a dataset", "Add to notebook" (insert block RPC).

### Check it

DB test: a new dataset snapshot does not change a pinned sheet until updated;
parity for `SheetWorking`, `SheetEmpty`, `SheetTablet`.

### Exit

Every column's source is visible in its header and inspector; updating the
pinned snapshot is an explicit, audited action.

## SHEET-02 — Promote local columns

**Status (2026-10-02):** not-started; nod `todo`. [Evidence and remaining work](../RECONCILIATION.md#sheet-02).

**Original decision/dependency note:** approval depends on MDL-03.

### Design

`canvas/SheetPromote.dc.html`, `canvas/PromoteRejected.dc.html`.

### Scope

Select local columns; choose target (existing dataset with a new model version,
or a new dataset and model); define field type and unit per column; creates a
draft model version sent for approval; on approval values are written as a new
snapshot with the sheet as source and the columns switch from local to dataset;
on return, the reviewer's reason is shown with "Edit and resubmit" or "Keep
local", and nothing in the dataset changes.

### Start here

`api.preview_local_field_promotion` and `api.promote_local_field` (promote
immediately today, no approval), `src/lib/schema-evolution.ts`,
`src/components/sheet/canonical-sheet-lifecycle-panel.tsx`,
`tests/db/schema-evolution.test.ts`, `tests/db/model-evolution.test.ts`.

### Steps (PRs)

1. Promotion request: RPC `request_column_promotion` creating a draft
   dataset schema version (or new dataset + model) with the chosen field
   types/units and a pending promotion record; nothing is written to the
   dataset. Uses MDL-03 approval.
2. On approval: write values as a new snapshot sourced from the sheet and
   switch the sheet columns from local to dataset (single transaction). On
   return: record reason; columns stay local.
3. Promote dialog (`SheetPromote`) and returned banner (`PromoteRejected`).
4. Remove direct `promote_local_field` use from the UI (keep the RPC only if
   another caller needs it; otherwise retire it in a migration).

### Check it

DB tests: no dataset change before approval; approval writes exactly one
snapshot; return changes nothing.

### Exit

A promotion never writes dataset values before approval (database test); a
returned promotion leaves the sheet and dataset unchanged.

## SHEET-03 — Sheet-cell and range comments

**Status (2026-10-02):** not-started; nod `todo`. [Evidence and remaining work](../RECONCILIATION.md#sheet-03).

**Original decision/dependency note:** closes the NEXT.md collaboration gap.

### Design

Row comments in the `canvas/Notebook.dc.html` inspector; `canvas/ReviewRecord.dc.html`
(comments on a changed cell); ⌥⌘M in `canvas/Shortcuts.dc.html`.

### Scope

Comment anchors on canonical sheet cells, rows and ranges, stable across row
reordering and schema versions; visible marker in the grid; thread in the
inspector; included in review and search (SRCH-01).

### Start here

`api.comments` (`target_kind IN ('revision','block','table_region','diff')`,
`target` JSON), `src/lib/comments-data.ts`, `src/components/comments/`,
`tests/db/anchored-comments.test.ts`. `sheetbase-table` supports per-cell
annotations (`initialAnnotations`, `onAnnotationsChange`).

### Steps (PRs)

1. New target kinds `sheet_cell`, `sheet_row`, `sheet_range` anchored to
   stable row IDs and column (field) IDs, not coordinates; migration widening
   the check; anchoring survives sort, filter, insertion and schema upgrades
   (DB tests for each).
2. Grid markers via the table annotations API; inspector thread; ⌥⌘M
   shortcut; included in the record's comment list and search (SRCH-01).

### Check it

DB tests for anchor stability; component test for marker and thread.

### Exit

A comment on a cell survives sort, filter, row insertion and a model version
upgrade, and is listed in the record's comment tab.

## SHEET-04 — Templates

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#sheet-04).

**Original decision/dependency note:** largely restyling existing REUSE capability.

### Design

`canvas/TemplatesList.dc.html`, `canvas/TemplateEditor.dc.html`,
`canvas/TemplateUpdate.dc.html`; template banner in `canvas/Notebook.dc.html`.

### Scope

Templates list across kinds (notebook, sheet, record) with version, status,
built-on, in-use counts; editor with sections, sheet column definitions
(source, type, unit, required, rule), placeholder text, changes since the last
version and publish impact; per-notebook update view listing what the new
version would add or change, with Apply recorded as a template update.

### Start here

`src/routes/templates.tsx` (614), `src/components/templates/template-library.tsx`
(1,249), `versioned-notebook-templates.tsx` (1,305),
`src/components/stewardship/notebook-template-upgrade-form.tsx`,
`src/lib/templates.ts`, `src/lib/notebook-template-upgrade.ts`,
`src/lib/reuse-upgrade.ts`. First fix the REUSE-02 CI failure in
`versioned-notebook-templates.test.tsx` (see `../../NEXT.md`).

### Steps (PRs)

1. Fix REUSE-02 with a regression test.
2. Templates list (`TemplatesList`) across notebook, sheet and record kinds.
3. Template editor (`TemplateEditor`): sections, sheet column definitions,
   placeholder text, changes since last version, publish impact.
4. Per-notebook update view (`TemplateUpdate`) on the existing upgrade APIs;
   notebook banner (EXP-04).

### Check it

`pnpm test src/components/templates`, `tests/api/templates.test.ts`; parity for
the three boards.

### Exit

Publishing a version changes no existing notebook; owners are told and choose;
signed notebooks cannot be updated; REUSE-02 baseline failure is fixed first.

## SHEET-05 — Analysis workspace

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#sheet-05).

**Original decision/dependency note:** lifts the single-dataset visualisation limit.

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

### Start here

`src/routes/analysis.tsx` (1,579 lines), `src/lib/analysis-definition.ts`,
`analysis-studio-data.ts`, `analysis-definitions-data.ts`, `chart-spec.ts`,
`chart-data.ts`, `src/components/viz/`, `tests/db/sci-02-analysis-definitions.test.ts`,
`tests/db/sci-03-analysis-blocks.test.ts`, ADR-0040/0041. Current limit:
single dataset source.

### Steps (PRs)

1. **Sources and joins.** Extend the analysis definition with additional
   sources joined on a field (server-side join in the analysis query, with a
   match report). ADR note if ADR-0040 changes. DB tests.
2. **Multiple charts** per analysis with shared x; fields panel with roles;
   calculated fields (formula IR from `src/lib/formula-ir.ts`).
3. **Stale detection.** Record input versions per analysis version; mark stale
   when a source changes; re-run and save as new version; embedded figures
   pin the version.
4. **Exclusions and diagnostics** (DSET-01 flags), Data / Diagnostics /
   Versions tabs; routes `/analysis` and `/analysis/$analysisId`;
   `AnalysisEmpty`.
5. Experiment Results tab outputs (`ExpResults`).

### Check it

DB tests for join and staleness; parity for `Analysis`, `AnalysisEmpty`,
`ExpResults`.

### Exit

The seeded AN-0057 reproduces both charts and the diagnostics in the design;
an edit to a source row marks the analysis stale and signed records keep the
cited version.

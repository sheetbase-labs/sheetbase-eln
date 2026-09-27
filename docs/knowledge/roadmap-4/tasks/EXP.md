# EXP — Experiments and Notebooks

**Status (2026-09-27):** Proposed; not assigned.

## Programme goal

Make an experiment readable as a plan, a working notebook and a result, with
its samples, data, files and history one tab away, and keep work safe when the
connection drops.

## Baseline at `main` `9538f36`

- Experiments are `records` of kind `experiment` with notebook `blocks`,
  opened at `/records/$recordId` and `/records/$recordId/overview`
  (`components/overview/`).
- Notebook: `block-editor`, `block-picker`, `notebook-sheet-block`,
  `conflict-banner`, outline and history panels; `use-autosave` holds saves in
  memory while offline and retries on reconnect (ADR-0018).
- Templates with versions, instantiation and upgrade (REUSE); protocol and
  materials block contract (ADR-0027); submission readiness guide (ASSIST).
- `create-blank-experiment-dialog`, `duplicate-notebook-dialog`,
  `amend-notebook-dialog` exist.

## EXP-01 — Experiment page frame and tabs

**Status:** proposed.

### Design

`canvas/ExpOverview.dc.html`, `Notebook`, `ExpSamples`, `ExpDatasets`,
`ExpResults`, `ExpFiles`, `ExpHistory`, `ExperimentsList`, `ExperimentsLoading`.

### Scope

- Header: breadcrumbs, title, Share, Submit for review, status line (status,
  owner, started, protocol version, client, saved time).
- Tabs as child routes: Overview, Notebook, Samples, Datasets, Results, Files,
  History, with counts.
- Experiments list (`/experiments`): tabs, filter chips, open issues column,
  loading skeleton.
- Samples tab: samples used or produced, lineage and properties in the
  inspector, print label, register sample.
- Datasets tab: linked datasets, filtered rows, provenance and selected-value
  inspector.

### Exit

All seven tabs render from real queries and match their design screens on
seeded data; each tab is a URL.

## EXP-02 — Overview: plan, progress and readiness

**Status:** proposed; protocol steps depend on LAB-07.

### Design

`canvas/ExpOverview.dc.html`.

### Scope

Objective and acceptance criteria; protocol progress (each protocol step with
status, who, when and evidence links); "open before submission" (validation
errors, open comment threads, empty required fields) with deep links to the
cell, thread or field; preliminary key results; properties (collaborators,
reviewer, planned end); linked experiments (upstream, next).

### Exit

Readiness items are computed on the server from the same checks submission
enforces; every item links to the exact location that resolves it.

## EXP-03 — New experiment from a protocol

**Status:** proposed.

### Design

`canvas/NewExperiment.dc.html`, `canvas/NbNew.dc.html`.

### Scope

Create from an approved protocol version (only effective ones when the project
requires it, PROJ-03) or a blank notebook; reviewer, planned end, "follows"
link, copy materials from the followed experiment. The draft is private to its
owner until started; "Start experiment" is blocked by a checklist of required
items; drafts can be deleted, and the ID is never reused.

### Exit

Draft visibility is enforced by RLS; starting records the status change in
History; the protocol version is pinned to the experiment.

## EXP-04 — Notebook working surface

**Status:** proposed.

### Design

`canvas/Notebook.dc.html`, `NbEditing`, `NbViewer`, `NbSigned`, `NbLoading`,
`design-system/components/SheetGrid/README.md`, `Inspector/README.md`.

### Scope

- Prose within 680px, sheets and charts wider; template-version banner
  (TemplateUpdate via SHEET-04).
- Sheet block with column group headers naming each source, `Source` badges,
  ƒx columns, a "New run" row, draft-row state and save-on-Enter.
- Insert-block menu (/ and +) with filter.
- Inspector: selected cell (value, validation, actions), provenance (dataset
  row, instrument, captured, entered by, edited), column definition,
  comments on the row; Comments and History tabs.
- Pipeline proposal block (accept, compare, reject; PIPE-03).
- View-only mode for viewers (copy, export, comment, request edit access);
  signed mode (read-only, signatures table, amendment entry point).

### Exit

Editing, view-only and signed notebooks match their design screens; a viewer
cannot enter edit mode by any route (tested at RPC level).

## EXP-05 — Offline editing and conflict resolution

**Status:** proposed; after [DEC-09](DEC.md).

### Design

`canvas/NbOffline.dc.html`, `canvas/NbConflict.dc.html`, `canvas/SignedOut.dc.html`;
workspace toggle in `canvas/SettingsGeneral.dc.html`.

### Scope

- Persist unsynced edits (text, sheet cells, added rows, comments) on the
  device (IndexedDB), with a cached copy of the notebook; mark unsynced values.
- Offline banner with last sync and retry; list of unsynced changes; features
  that need a connection (import, re-run, submit, sign, search) disabled with
  the reason.
- On reconnect, replay edits with their expected revisions; non-overlapping
  edits merge; overlapping cell edits produce a per-cell conflict with both
  values, authors, times and reasons; resolution requires a reason; dependent
  calculations are held until resolved.
- Edits survive sign-out and sync on next sign-in by the same user only.
- Workspace setting to allow or forbid offline editing.

### Exit

Browser tests cover offline edit, reconnect merge, a two-user cell conflict
and sign-out retention; both conflicting values and the decision appear in
History.

## EXP-06 — History tab

**Status:** proposed.

### Design

`canvas/ExpHistory.dc.html`.

### Scope

Filters (data, text, status, files, comments, signatures, actor); day groups;
entry inspector with old/new value, reason, session and knock-on changes
(recalculated cells, stale analyses); export audit trail; times in the
workspace time zone.

### Exit

Every change listed in the design's scenario is produced by the real audit
sources; export matches what is shown.

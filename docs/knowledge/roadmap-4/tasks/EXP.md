# EXP — Experiments and Notebooks

**Status (2026-10-02):** Reconciled against `9bbd305c`; see [task evidence](../RECONCILIATION.md#exp) and [live tracker](../CHECKLIST.md). Baseline sections describe the original planning snapshot, not current absence.

**Original scope note (2026-09-27):** Original proposal. Current status is reconciled below.

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

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#exp-01).

**Original decision/dependency note:** Original proposal.

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

### Start here

- `src/routes/records/$recordId.tsx` (2,533 lines: notebook page today) and
  `src/routes/records/$recordId/overview.tsx` (731), `src/components/overview/`
  (`overview-tabs.tsx`, `overview-view.tsx`), `src/components/record/`
  (`record-header.tsx`, `inspector.tsx`, `inspector-sections.tsx`).
- Data: `src/lib/notebook-data.ts` (records, blocks), `src/lib/overview.ts`, record links (`api.record_links`,
  link types `sample | protocol | dataset | reagent | analysis | file | general | template`).
- Design: render `ExpOverview`, `Notebook`, `ExpSamples`, `ExpDatasets`,
  `ExpResults`, `ExpFiles`, `ExpHistory`, `ExperimentsList`, `ExperimentsLoading`.

### Steps (PRs)

1. **Route split.** Make `/records/$recordId` a layout with child routes
   `overview`, `notebook`, `samples`, `datasets`, `results`, `files`, `history`
   (default `notebook`); move the existing notebook body into
   `notebook.tsx` unchanged. Header per design with status line and tab counts.
2. **Experiments list** `/experiments` (new): server summary RPC
   `experiment_list_summary` (project, owner, protocol version, status, open
   issues, started, updated), tabs and filter chips.
3. **Samples tab** from sample links with lineage and properties in the
   inspector (reuses LAB-03 components when they land; until then the
   existing `samples/sample-inspector.tsx`).
4. **Datasets tab** from dataset links with row view filtered to this
   experiment and the provenance inspector.
5. Results and Files tabs are delivered by SHEET-05 and PROJ-04; History by
   EXP-06.

### Check it

Existing notebook tests still pass after step 1; parity for each tab as it
lands.

### Exit

All seven tabs render from real queries and match their design screens on
seeded data; each tab is a URL.

## EXP-02 — Overview: plan, progress and readiness

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#exp-02).

**Original decision/dependency note:** protocol steps depend on LAB-07.

### Design

`canvas/ExpOverview.dc.html`.

### Scope

Objective and acceptance criteria; protocol progress (each protocol step with
status, who, when and evidence links); "open before submission" (validation
errors, open comment threads, empty required fields) with deep links to the
cell, thread or field; preliminary key results; properties (collaborators,
reviewer, planned end); linked experiments (upstream, next).

### Start here

`src/components/overview/overview-view.tsx`, `src/components/assist/submission-readiness-guide.tsx`
and `src/lib/assist-guide.ts` (readiness today), `src/lib/protocol-materials.ts`,
protocol blocks (`protocol-material-blocks.test.tsx`), review check results
(`api.review_check_results`, `src/components/review/review-check-results.tsx`).

### Steps (PRs)

1. **Readiness on the server.** RPC `experiment_readiness(record_id)`
   returning validation errors (with sheet/cell location), open comment
   threads, empty required fields; the submit RPC uses the same function so the
   list and the block agree. DB tests.
2. **Protocol progress.** Store step status against the pinned protocol
   version's steps (who, when, evidence links); needs LAB-07's protocol step
   model; until LAB-07 lands, derive from protocol blocks.
3. **Links.** Add `follows` and `upstream` link types (migration widening the
   check), set on creation (EXP-03) and editable in the inspector.
4. Overview UI per `ExpOverview`: objective, protocol progress, open before
   submission (each item deep-links), key results, properties, linked
   experiments, signatures.

### Check it

DB tests for readiness parity with submit; parity for `ExpOverview`.

### Exit

Readiness items are computed on the server from the same checks submission
enforces; every item links to the exact location that resolves it.

## EXP-03 — New experiment from a protocol

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#exp-03).

**Original decision/dependency note:** Original proposal.

### Design

`canvas/NewExperiment.dc.html`, `canvas/NbNew.dc.html`.

### Scope

Create from an approved protocol version (only effective ones when the project
requires it, PROJ-03) or a blank notebook; reviewer, planned end, "follows"
link, copy materials from the followed experiment. The draft is private to its
owner until started; "Start experiment" is blocked by a checklist of required
items; drafts can be deleted, and the ID is never reused.

### Start here

`src/components/notebook/create-blank-experiment-dialog.tsx`,
`duplicate-notebook-dialog.tsx`, template instantiation RPC
`api.instantiate_notebook_template_version`, `src/lib/templates.ts`,
`src/components/templates/template-library.tsx`, `tests/db/notebook-template-instantiate.test.ts`.
Status is free text on `api.records.status` changed by direct update today;
drafts are visible to all members.

### Steps (PRs)

1. **Lifecycle.** Add a controlled experiment lifecycle
   (`draft → in_progress → in_review → returned → approved`, plus amendments)
   enforced by an RPC `set_experiment_status` with allowed transitions and
   reasons; remove direct status updates for experiments. DB tests.
2. **Private drafts.** RLS so a `draft` experiment is visible only to its
   owner (and admins); starting makes it visible. DB test with a second member.
3. **Start checklist.** RPC `start_experiment` refusing while required items
   (template-declared) are missing, and while PROJ-03 and LAB-07 rules fail
   (effective protocol, training).
4. **New experiment page** `/experiments/new` (project, title, protocol list
   with preview, reviewer, planned end, follows, copy materials) replacing the
   blank-experiment dialog; `NbNew` draft notebook state with the checklist.
5. Delete draft RPC; IDs never reused (check the identifier sequence).

### Check it

DB tests for transitions, draft visibility and start refusal; parity for
`NewExperiment`, `NbNew`.

### Exit

Draft visibility is enforced by RLS; starting records the status change in
History; the protocol version is pinned to the experiment.

## EXP-04 — Notebook working surface

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#exp-04).

**Original decision/dependency note:** Original proposal.

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

### Start here

`src/components/notebook/notebook-document.tsx` (1,426), `block-editor.tsx`
(2,720), `notebook-sheet-block.tsx`, `block-picker.tsx`,
`slash-command-menu.tsx`, `notebook-history-panel.tsx`, `save-status.tsx`,
`rich-text-editor.tsx` (TipTap), `pipeline-output-block-*.tsx`,
`src/components/comments/`, `src/components/collaboration/thread-panel.tsx`.
Viewer rules: `tests/db/gov-01-viewer-readonly.test.ts`.

### Steps (PRs)

1. Document layout: 680px prose, wide sheets and charts, v3 type; template
   version banner (data from REUSE upgrade APIs).
2. Sheet block chrome: group headers and `Source` badges, ƒx columns, new-run
   row, draft row; uses the COMP-06 grid when available (before then, the
   same props on the existing grid).
3. Insert-block menu per design (/ and +, filterable, keyboard).
4. Inspector tabs: Properties (selected cell value, validation and actions,
   provenance, column definition), Comments (block and row threads), History.
5. View-only mode (`NbViewer`): request edit access (SET-02 access request),
   copy selection, comment; signed mode (`NbSigned`): read-only, signatures
   table, amendment entry. Server already refuses viewer writes; add a test
   per new action.
6. Pipeline proposal block (PIPE-03 provides data).

### Check it

`pnpm test src/components/notebook`, `tests/browser/note-01-authoring.test.ts`,
parity for `Notebook`, `NbEditing`, `NbViewer`, `NbSigned`, `NbLoading`.

### Exit

Editing, view-only and signed notebooks match their design screens; a viewer
cannot enter edit mode by any route (tested at RPC level).

## EXP-05 — Offline editing and conflict resolution

**Status (2026-10-02):** not-started; nod `todo`. [Evidence and remaining work](../RECONCILIATION.md#exp-05).

**Original decision/dependency note:** [DEC-09](DEC.md) accepted 2026-09-27 ([ADR-0018](../../decisions/0018-notebook-autosave-and-conflict.md) amendment): IndexedDB device store, replay with expected revisions, block- and cell-level conflicts, drafts retained after sign-out until discarded.

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

### Start here

`src/components/notebook/use-autosave.ts` (+ test), `conflict-banner.tsx`,
`src/components/live/connection-status.tsx`, `live-event-provider.tsx`,
ADR-0018, expected-revision checks in block and sheet RPCs.

### Steps (PRs)

Split into five PRs, each shippable:

1. **Device store.** `src/lib/offline/store.ts` on IndexedDB (idb-keyval or a
   small wrapper) keyed by user and record; persist unsynced edits (text
   blocks, sheet cells, new rows, comments) with their expected revisions and
   timestamps. Unit tests with fake-indexeddb.
2. **Offline mode UI.** Banner with last sync and retry; unsynced markers on
   cells and blocks; unsynced list in the inspector; actions needing a
   connection disabled with reasons (`NbOffline`).
3. **Replay.** On reconnect, replay in order; non-overlapping edits commit;
   overlapping cell edits become conflicts; held dependent calculations.
4. **Conflict resolution.** RPC `resolve_cell_conflict` recording both
   values, authors and the chosen or entered value with a required reason;
   UI per `NbConflict`; work item (WORK-01) for unresolved conflicts.
5. **Sign-out retention** (`SignedOut`) and the workspace setting (SET-01).

### Check it

Browser tests with Playwright offline mode (`context.setOffline(true)`):
edit, reconnect, merge; two contexts create a cell conflict; sign out and back
in keeps edits.

### Exit

Browser tests cover offline edit, reconnect merge, a two-user cell conflict
and sign-out retention; both conflicting values and the decision appear in
History.

## EXP-06 — History tab

**Status (2026-10-02):** partial; nod `in-progress`. [Evidence and remaining work](../RECONCILIATION.md#exp-06).

**Original decision/dependency note:** Original proposal.

### Design

`canvas/ExpHistory.dc.html`.

### Scope

Filters (data, text, status, files, comments, signatures, actor); day groups;
entry inspector with old/new value, reason, session and knock-on changes
(recalculated cells, stale analyses); export audit trail; times in the
workspace time zone.

### Start here

`src/components/audit/record-history-timeline.tsx`, `object-history-timeline.tsx`,
`audit-trail.tsx`, `src/lib/audit-history.ts` (562 lines),
`tests/db/gov-03-audit-events.test.ts`.

### Steps (PRs)

1. Extend `audit-history.ts` to return field, old value, new value, reason,
   session and knock-on effects (recalculated cells, stale analyses from
   formula dependencies and analysis inputs).
2. History tab: filter chips with counts, actor filter, day groups, entry
   inspector, "Export audit trail" (CSV of the filtered rows via a server route).

### Check it

Unit tests for grouping and knock-on derivation; parity for `ExpHistory`.

### Exit

Every change listed in the design's scenario is produced by the real audit
sources; export matches what is shown.

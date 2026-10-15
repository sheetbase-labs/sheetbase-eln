# Reach what we hold

Surfaces for data the ELN already writes but never shows. Planned at
`10a84a42`, 11 October 2026. Read [GUIDE.md](../GUIDE.md) and
[FINDINGS.md](../FINDINGS.md) sections 1–4. No new domain concept is needed: the
tables, the audit timeline and the not-found screen already exist.

## R5-SURF-01: dataset detail carries its Imports, Used by and History tabs

**Outcome:** opening a dataset shows where its rows came from, what uses it, and
what changed. Priority P0, effort L, low risk. No prerequisite.

**Current state and scope:** `src/routes/datasets/$datasetId.tsx:110-125` offers
Overview, Data, Snapshots and Compare. `dataset_imports` is defined at
`src/db/schema.ts:4877` (indexed at `:4960`) and referenced nowhere else in
`src/`, so per-dataset import history is written but unreadable.
`src/components/audit/object-history-timeline.tsx:229` is mounted only through
`object-history-dialog.tsx:66` for sheets, while datasets are a `change_events`
entity type. No dataset usage surface exists. Scope: three tabs (Imports, Used
by, History) and the dataset-level export and Analyse actions the design shows;
the Columns tab is deliberately not added (its design screen is a stub and
column identity is already visible in the Rows grid and the Model Fields tab).

**Steps:**

1. Confirm the canonical read models for each tab: which RPC or query answers
   "imports of this dataset", "objects referencing this dataset" and "changes to
   this dataset". Prefer an existing boundary; if a query must be added, add it
   at the canonical server boundary, never as a browser table read.
2. Add the three tabs to the dataset detail route, reusing `SearchTabs`/table
   primitives and the existing `ObjectHistoryTimeline`. Wire the tabs to route
   search parameters so a tab is linkable and reloadable.
3. Add the dataset `Download CSV` export (reusing `src/routes/api/export/...`)
   and the Rows tab's Analyse entry point. Keep empty, denied and
   no-imports-yet states explicit.
4. Record which Result shape each tab shows and why, in the tab's own docs, so a
   later audit does not re-open "the design has a Columns tab".

**Verification/exit:** focused component tests for each tab (populated, empty,
denied), a DB test that an import commit appears in that dataset's Imports tab,
and `pnpm validate`. A dataset with no imports, no references and no changes
shows three honest empty states rather than tables with fixture rows. Prove the
History tab against a real change (`change_events`) rather than a seeded array.

## R5-SURF-02: a project lists its own datasets, samples and experiments

**Outcome:** a project page lists the datasets, samples and experiments that
belong to it, with counts in the header. Priority P0, effort L, low risk. No
prerequisite.

**Current state and scope:** `src/routes/projects/$projectId.tsx:87-120` has
Overview, Milestones, Folders, Members, Settings only, with no header counts or
actions. The Overview shows the five most recent experiments
(`src/routes/projects/$projectId/index.tsx:161-224`); the global experiments
list can group by project (`src/routes/experiments.tsx:77,184-193`) but cannot
filter to one. No project-scoped dataset or sample list exists anywhere. Scope:
the three list tabs, the tab counts, and the header actions the design shows
(Members, New experiment); do not move the existing Folders or Files surfaces.

**Steps:**

1. Decide the authoritative project scope for each kind — membership,
   project-scoped objects or the existing `change_events` project association —
   and record it. Samples in particular need this decided before the tab exists.
2. Add the three routes under `src/routes/projects/$projectId/` using the same
   list pattern as the global registries, filtered by project at the canonical
   boundary (not by filtering a full page of results in the browser).
3. Add counts to the project header from the same queries, and the
   "New experiment" action linking to `/experiments/new?project=…` (that route
   already accepts a `project` search parameter).
4. Keep pagination or a bounded first page explicit: a project with more rows
   than the page shows must say so rather than silently truncate.

**Verification/exit:** focused tests per tab (populated, empty, denied, no
project access), a DB/API test that a project's rows are exactly its own, and
`pnpm validate`. A user without project access sees denied, not an empty list.
No cross-project leakage in either theme at desktop and phone widths.

## R5-SURF-03: unmatched URLs render the product's not-found screen

**Outcome:** an unknown URL renders the product's own screen inside the shell,
not the router default. Priority P0, effort S, low risk. No prerequisite.

**Current state and scope:** `src/components/v3/shell/not-found.tsx:16` is a
ported component mounted nowhere; there is no catch-all route and
`src/router.tsx` sets no not-found component. The component's `LAYOUTS` list
(`:6-13`) still names `/_app/...` route ids, which do not exist in the ELN, so
its nested branch can never match. Scope: wire the component, fix its route-id
list to current route ids, and cover both cases the design distinguishes —
unknown URL, and a known layout with an unknown record id.

**Steps:**

1. Decide where not-found belongs: a catch-all route under the app shell, or
   `notFoundComponent` on the root route plus per-layout handling. Prefer the
   option that keeps the shell, the theme and the navigation intact.
2. Replace the `/_app/...` ids with the ELN's actual route ids
   (`/experiments/$expId`, `/datasets/$datasetId`, …) and confirm the nested
   branch renders without a duplicate `h1` inside a record layout.
3. Give the screen a real next step: a link back to the section the pathname
   implies, plus search, rather than a dead end.
4. Check the signed-out and denied cases: an unknown URL must still render the
   shell's sign-in behaviour rather than leaking a page structure.

**Verification/exit:** component tests for unknown URL, unknown record id inside
a layout, and signed-out; one browser check that an unmatched path renders the
product's screen with one `h1` and no console error; `pnpm validate`.

## R5-SURF-04: an import is addressable, resumable and can create a dataset

**Outcome:** a specific import can be linked, reloaded and resumed, and an
upload can create a new dataset as well as append to one. Priority P1, effort M,
medium risk. No prerequisite; R5-CONFIG-01 is unaffected.

**Current state and scope:** the whole import flow is transient state inside
`src/components/import/import-flow.tsx`, so a map/check step cannot be linked or
recovered, and the empty state requires an existing dataset
("Create a dataset from a model first", `:475-484`). The design has an
addressable per-import route and an `Import into → New dataset` choice. Scope:
URL persistence for the flow, a per-import not-found state, the new-dataset
path, and filename-based parser pre-selection as a convenience over server
recognition.

**Steps:**

1. Decide what an import URL identifies. Recommended default: a stable job or
   draft identity, not a file name, with the schema/mapping pins the commit path
   already uses.
2. Persist flow state so a reload lands on the same step with the same file and
   mapping; keep the server the authority on what is valid.
3. Add the new-dataset path: choose a model, name the dataset, then continue
   through the same mapping and commit path. Do not create a second commit
   implementation.
4. Add parser pre-selection from the file name as a suggestion the user can
   override — never as silent parser assignment.

**Verification/exit:** component tests for reload-at-step, unknown import id and
the new-dataset branch; a DB/API test that the new path produces exactly one
dataset with the same provenance as the append path; `pnpm validate`. Confirm
the durable-job scope of the unnumbered scientific-workflow proposal before
extending this into background jobs — it owns that.

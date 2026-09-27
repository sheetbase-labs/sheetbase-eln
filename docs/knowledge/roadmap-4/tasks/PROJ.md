# PROJ — Projects, Folders, Files and Membership

**Status (2026-09-27):** Proposed; not assigned.

## Programme goal

Make a project a place where a lead can see scope, progress, people and files
at a glance, and set the rules records in it follow.

## Baseline at `main` `9538f36`

- `projects` has key, title, status and `custom_fields`; no client, modality,
  stage, lead, default reviewer, agreement or milestones.
- `folders`, `record_links`, `file_objects` (sha256 checksum, version,
  status) and `project_access` (per-user access level) exist.
- Study planning (`studies`, `study_deliverables`, `study_tasks`) exists
  separately from projects in `/planner`.

## PROJ-01 — Project properties and list

**Status:** proposed.

### Design

`canvas/Projects.dc.html`, `ProjectsEmpty`, `ProjectsError`, `ProjectsNoResults`,
`ProjectsTablet`; project creation in `canvas/DialogsCreate.dc.html`.

### Scope

- Typed project properties: client (reference), modality, stage, lead,
  default reviewer, agreement reference, start date. Decide whether these are
  columns or governed custom fields with a fixed model (MDL-01 informs this).
- Project list: tabs (All, Mine, In progress, In review, Archived), filter
  chips, sort, group, search, fields; inspector with details, experiments and
  activity; archived hidden by default with an explicit include.
- New project dialog, including "copy structure of" another project
  (milestones, members, protocols; never records).

### Start here

- `api.projects` (`key`, `title`, `status`, `custom_fields`, `archived_at`) in
  `src/db/schema.ts`; RPCs `api.create_project` and `api.project_list_summary`
  (search `drizzle/`); `tests/db/create-project-rpc.test.ts`.
- UI: `src/routes/projects.tsx`, `src/components/projects/project-list.tsx`,
  `tests/browser/projects-workflow.test.ts`.
- Design: render `Projects`, `ProjectsEmpty`, `ProjectsError`,
  `ProjectsNoResults`, `ProjectsTablet`; "New project" in `DialogsCreate`.

### Steps (PRs)

1. **Schema.** Add typed columns to `api.projects`: `client_id` (new
   `api.clients` table: workspace, code such as CL-017, name), `modality`,
   `stage` (workspace vocabulary via `configuration-vocabularies.ts`),
   `lead_user_id`, `default_reviewer_user_id`, `agreement_reference`,
   `started_on`, and a stable display ID `PRJ-nnnn`. Migration + RLS for
   `clients`; extend `create_project` and add `update_project_details`
   (expected revision). DB tests.
2. **Summary.** Extend `project_list_summary` with lead, client, stage,
   experiment counts and status; tabs (all, mine, in progress, in review,
   archived) as query parameters.
3. **List UI.** Rebuild `/projects` with filter chips (COMP-04), sort, group,
   fields, search, inspector (details, experiments, activity); archived hidden
   unless included; empty, error and no-results states.
4. **New project dialog** including "copy structure of" (server RPC copies
   milestones, members and protocol links, never records).

### Check it

`pnpm test:db create-project`, updated browser test, parity for the five
project list boards and the dialog.

### Exit

The project list and dialog match the design on seeded data; filters are URL
state; archived projects are read-only and excluded unless asked for.

## PROJ-02 — Milestones

**Status:** proposed.

### Design

`canvas/ProjectDetail.dc.html`, `ProjectLVV`, `ProjectAmbr`, `ClientPortal` (client view).

### Scope

Ordered milestones with status, target date, linked evidence records and
"experiments done" counts; overview tab showing milestones, recent
experiments, details, members, client access and open reviews. Reconcile with
`study_deliverables` rather than creating a second planning model.

### Start here

`api.studies`, `study_projects`, `study_deliverables`, `study_tasks` and
`/planner` (`src/components/planner/`, `tests/db/planner.test.ts`) already
model deliverables and dates; `src/routes/projects/$projectId.tsx` (1,288
lines) renders the project page today.

### Steps (PRs)

1. Decide with the SHELL-04 outcome for `/planner` whether milestones reuse
   `study_deliverables` or get `api.project_milestones` (order, title, status,
   target date, evidence links via `record_links`); write it in this task.
2. Milestone RPCs (create, reorder, update, link evidence) with DB tests.
3. Project Overview tab: milestones table, recent experiments, details,
   members summary, client access, open reviews; plus the LVV and Ambr
   variants (viewer notes, instrument details).

### Check it

Parity for `ProjectDetail`, `ProjectLVV`, `ProjectAmbr`.

### Exit

A milestone links to the records that evidence it and derives its status from
them where configured; the design's project overview renders from real data.

## PROJ-03 — Members, roles and project settings

**Status:** proposed; client rows depend on PORTAL. **DEC-06:** project access is by workspace groups ([ADR-0050](../../decisions/0050-workspace-groups-and-project-access.md), accepted 2026-09-27); **DEC-05:** client-portal access is a fourth rule column.

### Design

`canvas/ProjectMembers.dc.html`, `canvas/ProjectSettings.dc.html`.

### Scope

- Project roles (Lead, Scientist, Default reviewer, Oversight) alongside
  access (Editor, Reviewer, Viewer), group members, training status column
  (LAB-07), "how access works" explanation.
- Project settings: only effective protocols can start experiments; the
  reviewer must not be the author; auto-share approved records with the client
  portal.
- Archive: every record read-only, removed from lists, signed records remain
  available; warns about records still in progress.

### Start here

`api.project_access` (`access_level` owner/editor/viewer), RPCs
`grant_project_access` / `revoke_project_access`,
`src/components/workspace-admin/admin-project-access.tsx`,
`tests/db/overview-rls.test.ts`, `tests/db/roles.test.ts`.

### Steps (PRs)

1. Add `project_role` (lead, scientist, default reviewer, oversight) to
   project access, keeping `access_level` as the permission; groups arrive
   with DEC-06/SET-02 and client rows with PORTAL.
2. Project settings columns (`require_effective_protocol`,
   `require_independent_reviewer`, `auto_share_to_client`) enforced in the
   experiment-start RPC (EXP-03), the submit/sign RPCs (REV) and the share
   path (PORTAL); DB tests for each rule.
3. Archive project RPC: sets `archived_at`, blocks writes to its records via
   RLS/`record_is_locked`, keeps reads; warns if records are in progress;
   admin-only unarchive; audited.
4. Members and Settings tabs matching `ProjectMembers`, `ProjectSettings`.

### Check it

DB tests: an archived project's record cannot be edited; an author cannot sign
as reviewer when the setting is on; parity for both tabs.

### Exit

Each setting is enforced on the server (RPC and RLS), not only in the UI, with
database tests; archiving is reversible only by an admin and is audited.

## PROJ-04 — Folders and files

**Status:** proposed.

### Design

`canvas/ProjectFolders.dc.html`, `canvas/FolderMove.dc.html`,
`canvas/ProjectFiles.dc.html`, `canvas/ExpFiles.dc.html`,
`design-system/components/Tree/README.md`.

### Scope

- Folder tree (two levels) with item table across kinds (notebook, sheet,
  dataset, analysis, pipeline); multi-select move dialog; moves keep ID,
  links, history and access; cross-project moves refused with "copy instead".
- Files tab at project and experiment level: kind (instrument export,
  controlled copy, signed record, client document, working document), linked
  record, "parsed into" dataset rows, parser, SHA-256, retention date, text
  preview, "upload new version" (raw files are never edited or deleted).

### Start here

- `api.folders` (`parent_id`, `identifier`, `name`); only `api.records` has
  `folder_id`. Sheets have `project_id`; datasets, analyses and pipelines have
  neither, but the design's folder view lists all of them.
- Files: `api.file_objects` (`record_id`, `checksum`, `version`, `status`),
  `api.register_raw_file`, `src/lib/file-storage/`, `src/lib/file-policy.ts`,
  `src/lib/file-attach.ts`, `src/routes/api/files/*`, `tests/db/file-storage.test.ts`,
  `docs/subsystems/file-platform.md`.
- `src/lib/notebook-data.ts` (record listing with `folder_id`),
  `src/components/project-navigation-tree.tsx`.

### Steps (PRs)

1. **Placement model.** Add `api.folder_items` (folder, object kind, object
   id, unique per object) so any object kind can sit in one folder, migrate
   `records.folder_id` into it (or keep `folder_id` for records and add
   placement for the other kinds; record the choice here). RPC
   `move_to_folder(items[], folder_id)` refusing cross-project moves. DB tests.
2. **Folders tab** with the v3 `Tree`, mixed-kind item table, multi-select and
   the move dialog (`FolderMove`).
3. **File versions.** Add `previous_version_id` (or a `file_versions` chain)
   so "upload new version" creates version n+1 with its own checksum while
   older versions stay downloadable; raw files cannot be deleted; retention
   date from workspace policy (SET-01). DB tests.
4. **Files tab** (project and experiment) with kind, linked record, "parsed
   into" (from import records, DSET-05), parser, SHA-256, retention, text
   preview of the first lines.

### Check it

Parity for `ProjectFolders`, `FolderMove`, `ProjectFiles`, `ExpFiles`; DB tests
for move and versioning.

### Exit

Moving items changes only folder placement (tested); a new upload of an
existing file creates version 2 with its own hash while version 1 stays
downloadable; the files table matches the design on seeded data.

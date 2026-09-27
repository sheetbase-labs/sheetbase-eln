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

### Exit

A milestone links to the records that evidence it and derives its status from
them where configured; the design's project overview renders from real data.

## PROJ-03 — Members, roles and project settings

**Status:** proposed; client rows depend on PORTAL.

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

### Exit

Moving items changes only folder placement (tested); a new upload of an
existing file creates version 2 with its own hash while version 1 stays
downloadable; the files table matches the design on seeded data.

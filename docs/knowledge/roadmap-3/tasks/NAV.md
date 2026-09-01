# NAV — Workspace Navigation & Information Architecture

**Status:** active; NAV-01 and NAV-02 completed, NAV-03 planned.

## Programme goal

Make Sheetbase easy to orient, traverse and resume without flattening Notebook, Sheet, Dataset, Record and configuration concepts into generic pages.

## NAV-01 — Canonical Navigation Model

**Status:** completed 2026-08-30.

### Goal

Define and implement the canonical workspace/project navigation hierarchy and object destinations.

### Scope

- reconcile global, workspace, project and object navigation;
- remove duplicate/dead-end destinations and inconsistent naming;
- preserve stable object identity in URLs/navigation state;
- establish responsive sidebar/header behaviour.

### Exit

A user can predict where canonical object types live and move among workspace, project and object contexts without contradictory navigation models.

### Implemented contract

- The persistent product navigation has one destination per plane: Workspace,
  Scientific work, Configuration, Automation, Platform and specialist More
  tools.
- The contextual hierarchy is Workspace → Project → Folder → Record. Project
  and folder placement provide context; they do not redefine an object's
  workspace-owned identity.
- Canonical URLs carry stable IDs: `/projects/:projectId`,
  `/records/:recordId`, `/sheets/:sheetId`, `/datasets?dataset=:datasetId`,
  `/samples?selected=:sampleId`, `/reagents?selected=:reagentId`, and
  `/templates?template=:templateId` or `?protocol=:recordId` for the two
  distinct template catalogues. Historical notebook-template records remain
  readable at `/records/:recordId`.
- Search, audit, collaboration, dashboard, review, creation and template flows
  resolve destinations through the same canonical model. The superseded
  project-scoped experiment route is removed rather than retained as an alias.
- On desktop the sidebar expands or becomes a contained, labeled icon rail;
  project context remains in the header breadcrumbs. On narrow screens the
  same labeled navigation and project hierarchy use an independently scrolling
  drawer, while the inspector remains a separate responsive drawer.

## NAV-02 — Context-Preserving Object Navigation

**Status:** completed 2026-08-31.

### Goal

Keep scientific context visible while moving between related objects.

### Scope

- breadcrumbs/back-stack semantics based on stable IDs;
- links between Notebook, Sheet, Dataset, Record, analysis and evidence views;
- preserve useful project/workspace context when following relationships;
- avoid label- or browser-history-dependent reconstruction.

### Exit

Opening a related scientific object and returning preserves understandable project/object context without relying on accidental browser state.

### Implemented contract

- Object pages reconstruct their ancestor breadcrumbs from stable IDs on the
  object itself, never from browser history or the referring page. Sheets
  derive project and owning-notebook context from the instance's
  `projectId`/`notebookRecordId` via the shared sheet-instance query; the
  Dataset explorer names the selected dataset from the canonical
  `?dataset=` ID.
- The `objectContextBreadcrumbs` helper (`src/lib/navigation.ts`) is the one
  implementation of the Home → Projects → project → owning record → object
  contract; ancestor links carry stable IDs.
- Sheet footer provenance is navigable: dataset provenance resolves to
  `/datasets?dataset=…` and record provenance to `/records/:recordId`. This
  navigation contract is covered at route level in
  `src/routes/records/$recordId.test.tsx` ("Sheet provenance — route-level
  navigation") in addition to the component tests in
  `src/components/sheet/sheet-provenance.test.tsx`.
- Notebook ↔ Sheet is a two-way link: the embedded Sheet block offers
  "Open full sheet", carrying the canonical `?projectId` context so the
  full page opens with the same write affordances; the Sheet page links back
  through its breadcrumbs.
- The Analysis studio names the analysed dataset in its breadcrumbs and
  links back to `/datasets?dataset=…`, so analysis context is preserved in
  both directions.
- Read-only/write semantics (the `?projectId` search contract) are unchanged;
  NAV-02 alters navigation surfaces only.

## NAV-03 — Navigation Productivity & Responsive Behaviour

### Goal

Make navigation fast for repeated daily use.

### Scope

- keyboard-first navigation/command entry points;
- compact project/folder/object switching;
- responsive mobile/narrow-screen behaviour without separate semantics;
- accessibility and focus restoration.

### Exit

Core navigation workflows are keyboard-accessible, responsive and demonstrably faster than repeated manual sidebar traversal.

## Boundaries

- Do not invent a second project/folder/object ownership model.
- Do not use display labels as durable identity.
- FIND owns recents/favourites/search ranking; NAV only provides navigation surfaces.

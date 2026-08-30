# Roadmap 3 Tasks — Product Depth

## Programme outcome

Make the everyday scientist workspace fast, coherent and pleasant enough that advanced platform capabilities do not compensate for weak basic product interaction.

---

## NAV-01 — Workspace Navigation & Information Architecture

### Problem

As Sheetbase grows, users need to understand where they are, move between scientific objects quickly and recover context without relying on memorised routes or nested sidebars.

### Scope

- establish one coherent application information architecture across Projects, Notebooks, Sheets, Datasets, Records, Templates, Analysis and configuration;
- make global and contextual navigation consistent;
- add keyboard-first command navigation for canonical objects/actions;
- preserve project/folder context where meaningful without making folders a second ownership model;
- define breadcrumbs/back/context behaviour for deep scientific objects;
- reconcile recent/favourite affordances with FIND-01 rather than duplicating them.

### Non-goals

- redesigning canonical domain identity;
- creating a generic dashboard-card homepage;
- organisation hierarchy work;
- search engine changes owned by FIND-01.

### Dependencies

Roadmap 2 complete. Existing global search and canonical object routes remain inputs.

### Required evidence

- representative scientist navigation tests covering Notebook → Sheet/Dataset/Record → back/context flows;
- keyboard navigation/command accessibility;
- no route that exposes a shadow representation of a canonical object;
- responsive behaviour for compact layouts.

### Exit criterion

A scientist can navigate between their current project context and all primary canonical object types, open common actions from keyboard/command navigation, and return to prior context without ambiguous hierarchy or duplicate object surfaces.

---

## GRID-01 — Spreadsheet Interaction Depth

### Problem

Sheets are the primary structured-data work surface. They must feel materially closer to a serious spreadsheet while retaining Sheetbase provenance, typing, validation and write-target semantics.

### Scope

- deepen keyboard navigation, multi-cell/range selection and edit flows;
- fill/drag/copy/cut/paste workflows with typed validation;
- row/column insertion, deletion and bulk operations where canonical sources allow them;
- richer filtering, sorting, frozen/pinned columns and saved presentation state;
- efficient typed editors and error correction;
- formula authoring/discovery improvements using the existing formula IR/HyperFormula trust model;
- large-data interaction improvements without silently changing scientific analysis scope;
- visible provenance/write-target cues on demand rather than permanent clutter.

### Non-goals

- building a separate spreadsheet product;
- making row number semantic identity;
- bypassing Dataset/Record validation or RLS;
- analysis sampling changes;
- generic Sheet Version.

### Dependencies

Roadmap 2 complete; canonical compositional Sheet and ChartSpec/analysis contracts exist.

### Required evidence

- browser tests for keyboard/range/copy-paste/fill/bulk edits;
- DB/API tests proving correct write target and stable row identity;
- performance evidence at representative current row limits;
- failure tests for mixed writable/read-only/derived ranges.

### Exit criterion

A scientist can perform common spreadsheet-native editing and organisation workflows efficiently on compositional Sheets without losing typing, provenance, permissions or authoritative write-target semantics.

---

## NOTE-01 — Notebook Authoring & Composition Depth

### Problem

The Notebook should be a first-class scientific document, not merely a container around blocks and Sheets.

### Scope

- improve section/block insertion, movement, grouping and reordering;
- strong keyboard authoring and slash/command insertion patterns;
- better text, protocol, materials, files, Sheet, figure and analysis composition;
- stable contextual inspectors rather than modal/form-heavy editing;
- richer cross-links to canonical Records/Datasets/Sheets while preserving live-vs-pinned evidence semantics;
- clear authored vs generated/linked content distinctions;
- improve long-document navigation and section outline behaviour;
- preserve revision/sign/amend semantics from existing governance contracts.

### Non-goals

- replacing the Notebook with a generic document editor;
- automatic evidence pinning of all linked context;
- hidden Template inheritance;
- new workflow engine.

### Dependencies

Roadmap 2 complete. Existing Notebook, block, Template and evidence contracts remain canonical.

### Required evidence

- end-to-end authoring tests on mixed scientific content;
- revision/submission reconstruction tests after structural edits;
- accessibility/keyboard checks;
- no loss of stable block/source identity during reorder/move operations.

### Exit criterion

Scientists can create and restructure substantial mixed-content Notebooks fluidly while Sheetbase preserves stable scientific references, revision semantics and submitted evidence.

---

## FIND-01 — Contextual Discovery, Recents & Favourites

### Problem

Global search exists, but scientists also need lightweight ways to resume work, mark important objects and discover relevant context without repeatedly searching from scratch.

### Scope

- recent work across canonical object classes;
- favourites/pins with stable object identity;
- contextual suggestions such as related Records/Datasets/Notebooks based on explicit relationships and recent navigation;
- scoped discovery within project/context;
- command/navigation integration with NAV-01;
- resilient handling of archived/retired/inaccessible objects.

### Non-goals

- opaque recommendation algorithms;
- AI-generated scientific relevance claims;
- duplicate search index architecture;
- using labels instead of stable IDs for favourites/recents.

### Dependencies

NAV-01 recommended; existing global search and canonical identities.

### Required evidence

- permission-aware recent/favourite retrieval;
- deleted/archived/permission-changed object behaviour;
- cross-object navigation tests;
- no leakage across workspace boundaries.

### Exit criterion

A scientist can reliably resume and organise important work through recent/favourite/contextual discovery across canonical Sheetbase objects, with permissions and lifecycle changes handled correctly.

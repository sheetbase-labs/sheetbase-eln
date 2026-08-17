# PC — Product Consolidation

**Status:** PC-00 active; implementation epics provisional until audit review.

## Programme goal

Turn CORE-01–06 into one coherent scientist-facing product. A scientist should complete realistic work without understanding Sheetbase's internal object model or encountering separate ad-hoc/composed/legacy products.

## PC-00 — Product & Platform Consolidation Audit

**Status:** NEXT

### Goal

Establish the actual post-Core starting point and refine the roadmap from evidence.

### Audit

- routes, navigation and user-visible surfaces;
- canonical, duplicate, hidden and obsolete paths;
- Sheet modes/transitions and missing Core actions;
- Dataset and Record workflows;
- Notebook and Template workflows;
- configuration/governance;
- external API and credentials;
- import/export/files/search;
- collaboration;
- charts/analysis;
- integrations;
- platform/admin/operations;
- accessibility/keyboard behaviour;
- representative end-to-end workflows.

### Exit

A prioritised gap map, surface inventory, workflow findings, refined PC/API/DATA/GOV/PLAT scopes, recommended parallelisation and an updated `NEXT.md`.

---

## PC-01 — Canonical Sheet Experience

**Priority:** highest product priority after PC-00.

### Goal

One spreadsheet-native Sheet experience spanning ad-hoc and governed/composed states.

### Scope

- immediate editable blank Sheet;
- natural row/column insertion/deletion;
- multi-cell paste, copy/cut/fill;
- keyboard navigation/selection;
- type-aware editors and validation;
- formulas/calculations;
- Dataset and Record source binding;
- Record search/link/create;
- local and governed columns together;
- sorting/filtering/frozen columns;
- provenance inspection;
- explicit write-back;
- local-field/calculation promotion;
- extract/save as Definition;
- Definition upgrade;
- explicit materialisation;
- empty/loading/stale/conflict states;
- scalable virtualised interaction.

### Invariant

Do not expose "ad-hoc Sheet" and "composed Sheet" as separate products. They are states/capabilities of one Sheet experience.

### Exit

A scientist can start blank, work freely, add governed sources, create/link Records, calculate, promote useful structure and reuse it without leaving the canonical Sheet experience.

---

## PC-02 — Dataset & Record Product Workflows

### Goal

Make Datasets and Records understandable first-class scientific objects outside Sheet/Notebook infrastructure.

### Dataset scope

Catalogue; create; Schema selection; paste/import; controlled live edit; query/filter/sort/page; Schema Version inspection; immutable Versions; current vs historical context; dependency inspection; open in Sheet; export; lifecycle.

### Record scope

Model registries; create/edit; relationships; bulk create; identifiers; custom fields; usage/dependencies; lifecycle; links into scientific work.

### Exit

Users can manage durable structured data directly without needing a Notebook as the entry point.

---

## PC-03 — Notebook Experience

### Goal

Make Notebook the clear scientific-context and evidence container around narrative, Sheets, Records and files.

### Scope

- fast creation;
- rich text;
- block insertion/reorder/navigation;
- multiple Sheet blocks;
- Record/Dataset references;
- files/images;
- keyboard/block menus;
- duplication;
- metadata;
- revisions/history;
- working vs submitted state;
- review/signature/submission;
- frozen historical render;
- amendment/reopen where permitted;
- print/export/evidence presentation.

### Exit

A scientific experiment can be authored, worked, reviewed, submitted and revisited historically without exposing persistence concepts.

---

## PC-04 — Templates & Reusable Science

### Goal

Productise reusable Sheet Definition and Notebook Template capabilities.

### Scope

Notebook Template builder with stable identity, draft/published versions, narrative/Sheet placements, repeated Definition reuse, typed parameters/mappings, preview, history, lifecycle, instantiate, explicit upgrade and dependencies.

Sheet Definition catalogue with browse/find, versions, dependencies, create-from-Instance, draft editing, publish/retire and consumer upgrade.

### Exit

A Steward can encode repeatable scientific work without copying live data or creating hidden shared state.

---

## PC-05 — Configuration & Steward Workspace

### Goal

Make `/configure` the canonical organisational configuration plane.

### Scope

Models; Model fields; Dataset Schemas/Versions; Sheet Definitions; Notebook Templates; vocabularies; dependencies; lifecycle; impact analysis; promotion/evolution review; role/capability visibility.

### Design direction

Dense, relational and immersive rather than a collection of unrelated admin forms.

### Exit

A Steward can understand and evolve the data language of a workspace without general workspace administration.

---

## PC-06 — Golden Workflow Consolidation

### Goal

Stop broad feature expansion and make representative workflows excellent.

### Golden workflows

1. Simple assay Notebook.
2. Purification experiment with multiple Datasets and Records.
3. Batch/Sample registration from paste.
4. Exploratory Sheet to governed/reusable structure.
5. Reusable Notebook Template with typed parameters.
6. Submitted evidence remaining unchanged after live mutations.

### Exit

Each workflow is efficient, understandable and free of architectural dead ends, duplicate paths and unexplained state transitions.

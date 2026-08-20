# PC — Product Consolidation

**Status:** PC-00 accepted. PC-01 complete (`#41`). PC-02 complete (`#44`). PC-03 complete (`#52`). PC-04 complete (`#53`). PC-05 complete (`#54` / `1d7a06a`); PC-06 is ready to merge (`#55`).

## Programme goal

Turn CORE-01–06 into one coherent scientist-facing product. A scientist should complete realistic work without understanding Sheetbase's internal object model or encountering separate ad-hoc/composed/legacy products.

## PC-00 — Product & Platform Consolidation Audit

**Status:** COMPLETE and accepted — [`../audits/PC-00.md`](../audits/PC-00.md)

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

**Priority:** medium. **Status:** Complete (`#41` / `7cca216` on `main`).

### Goal

One spreadsheet-native Sheet experience spanning ad-hoc and governed/composed states.

### Why this is first

PC-00 found two live Sheet products (HTML ad-hoc grid vs Handsontable composed grid) and Core RPCs with no UI: H2 composition adoption, Dataset bind, extract/upgrade/materialise, and Instance calculations. The engine is ready; the product is not.

### Dependencies

CORE-01–06 and Hardening H1–H5.

### Thin PC-03 enabling slice (in PC-01, not full PC-03)

Required so the canonical Sheet workflow can be exercised end-to-end:

- create a blank experiment/Notebook without instantiating a Template;
- submit the Notebook through the existing revision/evidence contract (`preview_submission_digest`, `submit_record_revision`).

Do **not** take on the rest of PC-03 (print/export package, slash UX overhaul, Template designer, amendment-from-Notebook, rich history chrome).

### Specialist navigation (in PC-01)

Demote specialist tools from **default** navigation: Analysis, Planner, Calendar, Storage, Instruments, Plate Designer. Do not delete routes. Keep them accessible as secondary (for example a More group, hidden nav, or direct URL). Lineage and Report Builder stay out of primary nav.

### Scope

- one grid stack for ad-hoc and composed states (do not keep `<Input>` vs Handsontable as separate products);
- natural row/column insertion/deletion;
- multi-cell paste, copy/cut/fill;
- keyboard navigation/selection;
- type-aware editors and validation;
- formulas/calculations via `mutate_sheet_instance_calculations` / read results;
- Dataset and Record source binding, including H2 `preview/apply_sheet_instance_composition_adoption`;
- Record search/link/create (existing composed RPCs; do not hard-code only `sample` if the Definition names another Model);
- local and governed columns together;
- sorting/filtering/frozen columns;
- provenance inspection;
- explicit write-back through existing Dataset/Record/local RPCs;
- extract/save as Definition; Definition upgrade; explicit materialisation (preview/apply + stale/conflict);
- empty/loading/stale/conflict states;
- scalable virtualised interaction.

### Invariant

Do not expose "ad-hoc Sheet" and "composed Sheet" as separate products. They are states/capabilities of one Sheet experience. Do not restore scientific-table editors.

### Data / API / security

Call existing RPCs. Do not invent a parallel writer. UI hide is not authorisation. External API allowlisting of the same RPCs is API-01, not a PC-01 rewrite.

**Do not** make `viewer` read-only here — that is GOV-01.

### Exit

A scientist can create a blank Notebook, work in one Sheet experience, add governed sources on the same Instance, create/link Records, calculate, extract/upgrade/materialise, submit through the existing evidence contract, and understand errors. Specialist tools are no longer in default nav.

**Evidence:** canonical Sheet workspace, blank Notebook create, submit via existing revision RPCs, specialist tools in secondary nav, formula dependencies from the existing IR (`#41`).

### Principal risks

Confusing adoption with promotion; performance at scientific scale; Record actions remaining sample-only; expanding the enabling Notebook slice into full PC-03.

---

## PC-02 — Dataset & Record Product Workflows

**Priority:** medium. **Status:** Complete (`#44` / `b01b029` on `main`).

PC-00: `/datasets` is read-only; Dataset create/snapshot/live edit RPCs exist; reagent create UI is missing while sample create exists.

### Goal

Make Datasets and Records understandable first-class scientific objects outside Sheet/Notebook infrastructure.

### Dataset scope

Catalogue; create; Schema selection; paste/import; controlled live edit; query/filter/sort/page; Schema Version inspection; immutable Versions; current vs historical context; dependency inspection; open in Sheet; export; lifecycle.

### Record scope

Model registries; create/edit; relationships; bulk create; identifiers; custom fields; usage/dependencies; lifecycle; links into scientific work.

### Exit

Users can manage durable structured data directly without needing a Notebook as the entry point.

**Evidence:** Dataset product create/snapshot/live edit; strict integer/decimal/boolean coercion; historical Versions render the pinned Schema Version; reagent create. Sheet Dataset bind remains on the canonical Sheet Instance (`#44`).

---

## PC-03 — Notebook Experience

**Priority:** medium. **Status:** Complete (`#52` on `gwp/pc-03-notebook-experience-151b`).

### Goal

Make Notebook the clear scientific-context and evidence container around narrative, Sheets, Records and files.

### PC-00 note

Blank create and submit shipped in PC-01 as an enabling slice. This epic is the full Notebook product around existing Core contracts. Do not invent a second domain model. Do not reopen PC-01/PC-02. Human submit/sign/amend remains session-only.

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

**Evidence:** Notebook chrome on existing Core RPCs — working vs submitted, history, amendment-from-Notebook, `?revision=` frozen render, duplicate, metadata, print/evidence download, Dataset/Record reference kinds, image file preview, slash aliases and grouped insert, reviewer assignment, Record/Dataset search, Sign from the submitted Notebook (`sign_revision`, session-only), insert-below and Alt+Enter, chart picker grouped by this Notebook vs workspace (SCI-004 table ids remain the freeze contract; not a second Dataset bind). Template designer remains PC-04.

---

## PC-04 — Templates & Reusable Science

### Goal

Productise reusable Sheet Definition and Notebook Template capabilities.

### Scope

Notebook Template builder with stable identity, draft/published versions, narrative/Sheet placements, repeated Definition reuse, typed parameters/mappings, preview, history, lifecycle, instantiate, explicit upgrade and dependencies.

Sheet Definition catalogue with browse/find, versions, dependencies, create-from-Instance, draft editing, publish/retire and consumer upgrade.

### Exit

A Steward can encode repeatable scientific work without copying live data or creating hidden shared state.

**Evidence:** versioned Notebook Template authoring, placements/parameters, instantiate, explicit upgrade, Sheet Definition catalogue/create-from-Instance/publish/retire/consumer upgrade (`#53`).

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

**Implementation evidence:** `/configure` is the Steward data-language plane (Models, Dataset Schemas, Sheet Definitions, Notebook Templates, category vocabularies, field and calculation promotion, dependency/capability inspector). `/admin/model-fields` redirects to `/configure?kind=model`. SCI-010 copy is gone. Vocabularies reuse Field Definition category sources (ADR 0025); no second vocabulary product. Administration stays membership/security (`#54` / `1d7a06a`).

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

### Active delivery shape

1. Trace each named workflow through the canonical route, its existing RPCs and frozen-evidence boundary.
2. Remove verified UI hand-off dead ends without creating replacement domain systems.
3. Add workflow-level acceptance evidence around the concrete route/contract being consolidated.
4. Reuse the merged PC-05 Configuration and promotion paths for workflow 4.

**First slice:** after extracting an exploratory Sheet as a Definition, take the user directly to that Definition in `/configure` to review and publish it. This closes the local-to-governed/reusable hand-off without making field promotion a prerequisite.

### Golden workflow evidence matrix

| Workflow                                         | Canonical product path                                                                                              | Acceptance evidence                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Simple assay Notebook                            | Project → Create experiment → add Sheet → submit                                                                    | `create-blank-experiment-dialog.test.tsx`, `ad-hoc-sheet-workspace.test.tsx`, `submit-notebook-dialog.test.tsx` |
| Purification with multiple Datasets and Records  | Notebook Sheet Instance → composed Definition/Dataset bindings → local/calculated values → optional materialisation | `tests/db/sheet-composition.test.ts` “Purification Summary golden workflow”                                     |
| Batch/Sample registration from paste             | Samples → Import → validate → create Model Records                                                                  | `import-wizard.test.tsx` pasted-Sample workflow                                                                 |
| Exploratory Sheet to reusable structure          | Sheet lifecycle → extract Definition → `/configure` review/publish                                                  | `canonical-sheet-lifecycle-panel.test.tsx`, `configuration-workspace.test.tsx`                                  |
| Reusable Notebook Template with typed parameters | Templates → published version → choose project and typed parameter values → create Notebook                         | `template-parameter-inputs.test.tsx`, `versioned-notebook-templates.test.tsx`                                   |
| Submitted evidence remains unchanged             | Notebook submit → frozen Sheet/evidence rendering despite live mutations                                            | `tests/db/notebook-sheet-evidence.test.ts`, `notebook-sheet-block.test.tsx`                                     |

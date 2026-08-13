# Sheetbase Core Migration and Continuation Map

> **Purpose:** Tell an implementation agent what exists, what should be preserved, what should converge, what is paused and what should be built next.  
> **Target semantics:** `PRODUCT_CORE.md` and `CORE_ARCHITECTURE.md`.

## 1. Executive instruction

Do **not** restart Sheetbase.

The repository already contains strong foundations. The next programme is a convergence exercise around the Core Data Workspace.

For the duration of the core programme, avoid expanding specialist surfaces unless the work is required to prove a core primitive or fix a production defect.

## 2. Current-state classification

| Existing area | Classification | Direction |
|---|---|---|
| PostgreSQL + Drizzle migrations | **KEEP** | Remain authoritative; evolve through migrations |
| PostgREST API boundary | **KEEP** | Reuse for Models, Records, Datasets and Sheets; add controlled bulk RPCs |
| Row-level security | **KEEP** | Remains security boundary; extend with capability concepts incrementally |
| Better Auth / session bridge / API credentials | **KEEP** | No architectural reset required |
| Application shell / shared inspector | **KEEP** | Reuse as core configuration and Sheet context UI |
| Handsontable scientific sheet | **KEEP + EXTEND** | Becomes the main compositional Sheet interaction surface |
| HyperFormula integration | **KEEP + EXTEND** | Preserve trust/provenance model; adapt formula resolution for multi-source Sheets |
| Scientific table/dataset schema concepts | **CONSOLIDATE** | Converge with common field kernel and Dataset primitive |
| Extensible Model framework (PR #27) | **KEEP + ADAPT** | Foundation for Model/Field semantics and configuration lifecycle |
| Samples registry | **ADAPT** | Make increasingly generic over Model/Record contracts |
| Reagents registry | **ADAPT** | Same; preserve inventory-specific behaviour where genuinely domain-specific |
| Shared virtualised registry grid | **KEEP** | Important for dense/large read-oriented data views |
| Dataset Explorer | **ADAPT** | Become a Dataset/View surface rather than an independent data concept |
| Notebook block/document system | **KEEP + EXTEND** | Sheet blocks reference compositional Sheet objects; preserve notebook context |
| Analysis Studio | **PAUSE FEATURE EXPANSION** | Later consume Dataset/Pipeline/recorded-result primitives |
| Open PR #26 immutable analysis objects | **REVIEW AGAINST CORE BEFORE MERGE** | Useful provenance concepts; do not let it define a parallel transformation system |
| Planner / Calendar | **KEEP, PAUSE EXPANSION** | Operational surfaces are not core-programme priority |
| Instrument Monitor | **KEEP, PAUSE EXPANSION** | Later connect ingestion to Dataset/Pipeline contracts |
| Report Builder | **KEEP, PAUSE EXPANSION** | Later consume pinned Notebook/Dataset/Pipeline evidence |
| Storage/freezer | **KEEP, PAUSE EXPANSION** | Preserve; later express inventory identities consistently |
| Plate Designer | **KEEP, PAUSE EXPANSION** | Revisit after core data semantics settle |
| Current workspace owner/member roles | **ADAPT** | Introduce capability primitives without destabilising RLS |
| Pipeline engine | **BUILD LATER** | Define contracts now; implementation follows stable Models/Datasets/Sheets |
| Agentic mutation/configuration | **BUILD LATER** | Must use Pipeline/schema/mutation contracts, never bypass them |

## 3. Existing work that should be protected

### 3.1 Sheet calculation trust decisions

Preserve the existing decisions around:

- durable formula definitions;
- result caches not being sole authority;
- stable references beneath A1 notation;
- deterministic scientific function profile;
- exclusion of volatile/non-reproducible functions;
- calculation dependencies and provenance.

Do not simplify this into “store whatever Handsontable displays”.

### 3.2 Excel-like interaction work

Preserve and build on:

- formula bar;
- in-cell formula editing;
- A1 address display;
- reference picking;
- drag range selection;
- persistent coloured reference highlights;
- function autocomplete;
- copy/paste/fill semantics;
- explicit save state and errors.

### 3.3 Extensible model work

PR #27 established important contracts:

- PostgreSQL-authoritative model registry;
- protected base fields;
- workspace-owned typed fields;
- validation at the DB boundary;
- lifecycle controls;
- RLS;
- management RPCs;
- model-field administration UI.

Do not replace this with a new disconnected schema system. Extend/converge it into the common field kernel.

### 3.4 Dense registry/inspector system

Preserve the recent UI direction:

- compact default density;
- virtualisation/incremental loading;
- sticky/resizable tables;
- shared filters;
- slide-over/pinnable inspectors;
- data-plane dominance;
- minimal dashboard-card use.

This is consistent with the core product principles.

## 4. Main conceptual gaps

### GAP-1 — No unified field/schema kernel

Current Model fields and scientific Dataset/Sheet column definitions risk becoming separate type systems.

**Resolution:** create a shared semantic contract and compatibility layer before adding substantial new schema features.

### GAP-2 — Dataset is not yet the unequivocal durable rectangular-data primitive

Current table/sheet/dataset concepts need clearer ownership boundaries.

**Resolution:** formalise Dataset + Dataset Schema independent of Sheet presentation.

### GAP-3 — Sheet assumes too narrow a source model

The target Sheet must compose multiple Datasets/Models and local/calculated columns.

**Resolution:** add explicit Sheet bindings, row identity, joins, columns and write-back rules.

### GAP-4 — Row identity needs to be first-class

Visual row position is insufficient for multi-source composition.

**Resolution:** implement source/composite/local row identity semantics and use them in joins, formulas and local values.

### GAP-5 — Record creation from Sheet needs a platform contract

Scientists must be able to link/create Records without leaving the grid.

**Resolution:** implement typed Record-reference cells plus inline and validate/preview/commit bulk creation.

### GAP-6 — Local/ad hoc columns need durable storage and promotion

Exploratory columns cannot remain client-only.

**Resolution:** implement typed Sheet-local fields/values with a later promotion operation into Model/Dataset schemas.

### GAP-7 — Permissions are too coarse for configuration vision

Owner/member is insufficient for delegated model/schema/workflow configuration.

**Resolution:** introduce capability primitives incrementally, beginning with schema and Sheet/Dataset configuration.

### GAP-8 — Specialist workspaces can drift into parallel concepts

Analysis, instruments and reports can accidentally invent their own dataset/transformation identities.

**Resolution:** pause broad feature work and refactor future integrations through the core primitives.

## 5. Core programme epics

The repository roadmap should treat the following as the next high-level sequence.

### EPIC CORE-01 — Common Schema Kernel

**Goal:** Models and Datasets share one semantic field language.

Deliver:

- field-definition contract;
- compatibility with existing model fields;
- units, validation, vocabulary and relationship semantics;
- lifecycle/version semantics;
- dependency discovery foundation;
- capability boundary for schema configuration.

**Exit:** the same semantic type/constraint vocabulary can define a Model property and a Dataset field without duplicating incompatible concepts.

### EPIC CORE-02 — Dataset Primitive

**Goal:** Make Dataset the durable rectangular data object independent of its UI.

Deliver:

- Dataset identity;
- Dataset Schema identity/version;
- stable row and field IDs;
- PostgreSQL storage strategy ADR;
- CRUD/query API;
- bulk validation/write path;
- provenance and lifecycle;
- representative performance tests.

**Exit:** a Dataset can be created, queried, bulk-written and addressed through the API without a Sheet being present.

### EPIC CORE-03 — Compositional Sheet

**Goal:** Turn the scientific Sheet into a composition over multiple governed sources.

Deliver:

- Sheet object;
- Dataset and Model bindings;
- explicit row identity;
- constrained joins;
- bound/model/local/calculated columns;
- source/provenance inspection;
- unambiguous write-back;
- durable Sheet-local values;
- saved View separation.

**Exit:** one Sheet can combine at least two Datasets plus a Model and a local column while preserving correct edits and provenance.

### EPIC CORE-04 — Records from Sheets

**Goal:** Make the Sheet a first-class Record registration/linking surface.

Deliver:

- typed Record-reference cells;
- existing-record search/link;
- inline Record creation;
- bulk create from pasted/selected rows;
- validate/preview/commit UX;
- row/field error feedback;
- duplicate/uniqueness handling;
- permission-aware behaviour.

**Exit:** a scientist can paste a realistic table, resolve existing Records, create missing Records in bulk and continue working without leaving the Sheet.

### EPIC CORE-05 — Schema Evolution, Views and Role-aware Configuration

**Goal:** Make the system safely configurable by delegated roles.

Deliver:

- draft/publish/deprecate/retire schema lifecycle;
- dependency/impact UI;
- safe rename/add/retire operations;
- local-column promotion;
- saved user/team Views;
- capability-based schema/data configuration;
- role-specific defaults without divergent data.

**Exit:** a Data Steward can evolve a schema safely while a Scientist sees only the controls they are allowed to use.

### EPIC CORE-06 — Notebook Integration and Frozen Evidence

**Goal:** Make compositional Sheets native notebook objects with explicit live/pinned semantics.

Deliver:

- Sheet block references;
- live versus pinned state;
- notebook template integration;
- submitted-version freezing/pinning rules;
- chart/data consumers using stable Sheet/Dataset identities;
- provenance reconstruction.

**Exit:** a notebook can contain a live working Sheet and later produce an immutable submitted state that can be reconstructed exactly.

### EPIC AUTO-01 — Pipeline Foundation

**Goal:** Introduce versioned typed transformations after the data substrate is stable.

Deliver:

- Pipeline Definition/Run contracts;
- typed inputs/outputs;
- configured transform runner;
- SQL/Python execution boundary;
- provenance/logging;
- permission/publish/run lifecycle;
- Dataset outputs.

**Exit:** a versioned transformation consumes pinned input Dataset versions and produces a traceable output Dataset version reproducibly.

### EPIC AUTO-02 — Agent-authored Operations

**Goal:** Let AI propose governed transformations/configuration without bypassing platform rules.

Deliver:

- structured proposed plans;
- schema/capability validation;
- human-readable diff/impact;
- draft Pipeline/schema authoring;
- approval policy;
- execution through ordinary APIs;
- agent/model/tool provenance.

**Exit:** an agent can propose a useful data transformation, a user can inspect/approve it, and execution produces the same evidence as a human-authored Pipeline.

## 6. Immediate implementation order

An agent continuing from this branch should work in this order unless an ADR or discovered constraint justifies a change:

1. CORE-01 common schema kernel.
2. CORE-02 Dataset primitive.
3. CORE-03 minimal single-source Sheet adaptation onto the new contracts.
4. CORE-03 multi-source binding + row identity + join.
5. CORE-03 local/calculated columns + write-back.
6. CORE-04 Record linking/creation.
7. CORE-05 schema lifecycle/capabilities/views.
8. CORE-06 notebook live/pinned integration.
9. AUTO-01 Pipeline foundation.
10. AUTO-02 agentic layer.

Do not begin with a visual Pipeline builder.

## 7. Golden workflow used as the programme acceptance test

Use one representative workflow throughout implementation:

**Notebook: Lentivector purification experiment**

Sheet composition:

- `Sample` Model records;
- `Upstream Results` Dataset;
- `Purification Results` Dataset;
- local `Observation` column;
- calculated `Recovery` column.

The workflow must eventually prove:

1. insert Sheet into Notebook;
2. bind Sample Model and two Datasets;
3. row identity = Sample ID;
4. join both Datasets by Sample;
5. paste data;
6. link existing Samples;
7. create missing Samples inline/bulk;
8. calculate Recovery;
9. add local observations;
10. edit source-backed fields with correct write-back;
11. filter/sort/save View;
12. inspect provenance/API identity;
13. reload consistently;
14. pin/freeze for submitted Notebook evidence.

This workflow is more important than completing unrelated screens.

## 8. Rules for agents working during the core programme

1. Read `docs/core/PRODUCT_CORE.md`, `CORE_ARCHITECTURE.md`, `CORE_MIGRATION.md`, `PRODUCT.md`, `DESIGN.md` and relevant ADRs before architectural changes.
2. Treat the Core docs as the target when older roadmap language assumes one Sheet = one table/Dataset.
3. Do not remove working security, RLS, API or calculation guarantees to simplify implementation.
4. Prefer adapting existing migrations/contracts through new migrations; never rewrite applied history.
5. Do not create a second Model, Dataset, calculation, lineage or permission system inside a specialist route.
6. Add an ADR when implementation settles a deferred durable contract.
7. Build vertical slices with DB + API + UI + tests rather than isolated UI mock behaviour.
8. Preserve information density and existing visual direction.
9. Use stable IDs for dependencies; labels and visual positions are presentation.
10. When uncertain, optimise for reconstructability, explicit provenance and future composability.

## 9. Work intentionally paused

Until CORE-01 through CORE-04 are substantially proven, avoid feature expansion in:

- Analysis Studio;
- Planner;
- Calendar;
- Instrument Monitor;
- Report Builder;
- Storage/freezer;
- Plate Designer;
- new dashboard surfaces.

Bug fixes, security fixes and small convergence changes are fine.

## 10. Open PR guidance

At the time of this reset, PR #26 contains useful immutable analysis-result concepts but is intentionally hidden from primary product navigation.

Before merging or extending it, review whether its concepts map cleanly to:

- Dataset versions;
- future Pipeline Runs;
- Notebook pinned evidence;
- the common provenance model.

Avoid committing to a separate long-term `AnalysisRun` architecture if Pipeline Run can become the more general primitive.

## 11. Definition of “core is solid enough to broaden again”

Resume broad specialist feature development when:

- common field semantics are stable;
- Dataset is independent and API-addressable;
- a Sheet composes multiple sources;
- row identity and joins are explicit;
- local/calculated columns are durable;
- write-back is unambiguous;
- Records can be linked/created from Sheets;
- schema changes have lifecycle/impact handling;
- capability-based configuration exists at least for core actions;
- a Notebook can pin/freeze its structured evidence.

At that point Analysis, instruments, reporting and Pipelines can be built on a much firmer substrate.
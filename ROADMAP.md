# Sheetbase roadmap

> **Active programme:** Core Data Workspace.  
> **Canonical core definitions:** [`docs/core/README.md`](./docs/core/README.md), [`PRODUCT_CORE.md`](./docs/core/PRODUCT_CORE.md), [`CORE_ARCHITECTURE.md`](./docs/core/CORE_ARCHITECTURE.md), [`CORE_MIGRATION.md`](./docs/core/CORE_MIGRATION.md).

## Destination

Sheetbase is a scientific data workspace in which the notebook provides scientific context and Excel-like Sheets provide the primary structured-data interaction surface, while PostgreSQL remains authoritative.

A Sheet is not limited to one database table. It can compose multiple Datasets and Model Records together with local and calculated columns, explicit row identity, joins, provenance and unambiguous write-back. Scientists must be able to link and create Records directly from Sheets.

The product architecture should converge specialist surfaces onto shared Models, Records, Field Definitions, Datasets, Sheets, Views, Calculations, Policies and later Pipelines rather than creating independent applications or sources of truth.

## Principles that govern the route

- The notebook remains the centre of scientific context; registries and specialist workspaces support it.
- Sheets are the primary structured-data workspace and should feel familiar to Excel users without inheriting spreadsheet ambiguity as the data model.
- PostgreSQL is authoritative. PostgREST exposes safe CRUD and controlled RPCs, while row-level security remains the access-control boundary.
- Models and Dataset Schemas share a common semantic field language even when their physical storage differs.
- Handsontable is for spreadsheet-like scientific editing. TanStack Table/virtualised registry grids are for registries, queues and read-oriented operational views.
- HyperFormula formulas are durable definitions. Calculated values may be cached for display and querying, but they are never the sole authoritative representation of a calculation.
- Every durable dependency uses stable identities rather than labels, visual row positions or A1 coordinates.
- Every displayed Sheet value has inspectable provenance; every writable value has exactly one authoritative write target.
- Configuration is capability-based. Record editing, schema configuration, workflow authoring, review and workspace administration are distinct authorities.
- Information density, clarity, keyboard fluency and large-data performance are product requirements.
- AI is assistive, reviewable and attributable, and must use the same typed operations, permissions and provenance model as humans and code.
- The mockups and concept system remain the approved visual direction. Components are improved in place rather than replaced with a different aesthetic.
- Traceability, accessibility and failure states are designed with the normal workflow, not added after it.

## Current state

The repository has already established substantial foundations:

- TanStack Start/React application and production UI system;
- PostgreSQL, Drizzle, PostgREST, Better Auth, external API credentials and RLS;
- notebook/domain foundations;
- Handsontable scientific Sheets and HyperFormula calculation persistence;
- Excel-like formula editing/reference picking and a curated scientific function library;
- shared dense registries, filters and inspectors;
- an extensible PostgreSQL-authoritative Model framework with protected base fields and workspace fields;
- several specialist workspaces that can be retained as future consumers of the core.

The next task is **convergence**, not a rewrite and not continued feature breadth.

---

# Active programme — Core Data Workspace

## CORE-01 — Common Schema Kernel

Unify the semantic language used by Model fields and Dataset fields.

Deliver:

- stable Field Definition identity;
- common value types;
- units and unit dimensions;
- validation constraints;
- controlled vocabularies;
- Record relationships and cardinality;
- lifecycle/version semantics;
- compatibility with the existing extensible Model framework;
- initial schema-configuration capability boundary;
- dependency discovery foundation.

**Exit gate:** a Model property and Dataset field can use the same semantic type/constraint vocabulary without maintaining incompatible definitions.

## CORE-02 — Dataset Primitive

Make Dataset the durable rectangular data object independent of Sheet presentation.

Deliver:

- Dataset and Dataset Schema identities;
- stable row and field IDs;
- PostgreSQL physical-storage ADR and implementation;
- API resources and RLS;
- bulk validation/write operations;
- provenance/lifecycle;
- representative large-data performance tests.

**Exit gate:** a Dataset can be created, queried, bulk-written and addressed through the API without a Sheet being present.

## CORE-03 — Compositional Sheet

Evolve the existing scientific Sheet into a composition over governed sources.

Deliver:

- durable Sheet object;
- multiple Dataset and Model bindings;
- explicit source/composite/local row identity;
- constrained joins with cardinality checks;
- Dataset, Model, relationship, local and calculated columns;
- durable local values;
- source/provenance inspection;
- explicit write-back targets;
- View state separated from data/schema;
- existing Excel-like interaction preserved.

**Exit gate:** one Sheet combines at least two Datasets plus a Model and a local/calculated column, while edits reach the correct authoritative sources and provenance remains reconstructable.

## CORE-04 — Records from Sheets

Make Sheets a first-class Record registration and linking surface.

Deliver:

- typed Record-reference cells;
- existing-Record search/link;
- inline Record creation;
- bulk Record creation from pasted/selected rows;
- validate → preview → commit operation;
- row/field validation errors rendered in the grid;
- uniqueness/duplicate handling;
- permission-aware creation/update behaviour.

**Exit gate:** a scientist can paste a realistic table, resolve existing Records, create missing Records in bulk and continue working without leaving the Sheet.

## CORE-05 — Schema Evolution, Views and Role-aware Configuration

Make the core safely configurable by delegated roles.

Deliver:

- draft/publish/deprecate/retire schema lifecycle;
- safe add/rename/retire operations;
- dependency/impact inspection;
- local-column promotion into governed schemas;
- saved user/team Views;
- initial capability-based schema/data configuration;
- role-specific defaults without divergent underlying data.

**Exit gate:** a Data Steward can safely evolve a schema while a Scientist sees only permitted configuration, and historical data/dependencies remain interpretable.

## CORE-06 — Notebook Integration and Frozen Evidence

Make compositional Sheets native Notebook objects with explicit live/pinned semantics.

Deliver:

- Notebook Sheet-block references to durable Sheet objects;
- live versus pinned/frozen state;
- Notebook/template integration;
- submitted-version pinning rules;
- chart/data consumers using stable Sheet/Dataset identities;
- provenance reconstruction for submitted evidence.

**Exit gate:** a Notebook can contain a live working compositional Sheet and later produce an immutable submitted state that can be reconstructed exactly.

---

# Automation programme — follows stable Core Data Workspace

## AUTO-01 — Pipeline Foundation

Introduce versioned typed transformations only after the data substrate is stable.

Deliver:

- Pipeline Definition and Pipeline Run contracts;
- typed input/output ports;
- parameters and schema expectations;
- configured transformations;
- SQL/Python execution boundary;
- immutable run provenance/logging;
- permission, draft/publish and run lifecycle;
- Dataset outputs.

**Exit gate:** a versioned transformation consumes pinned input Dataset versions and reproducibly produces a traceable output Dataset version.

## AUTO-02 — Agent-authored Operations

Allow agents to propose governed transformations and configuration through ordinary platform contracts.

Deliver:

- structured proposed plans;
- capability/schema validation;
- human-readable change/impact preview;
- draft Pipeline/schema authoring;
- approval policy;
- execution through normal APIs/Pipeline runner;
- agent/model/tool provenance.

**Exit gate:** an agent can propose a useful data transformation, a user can inspect and approve it, and execution produces the same evidence as a human-authored Pipeline.

---

# Golden programme workflow

Use one representative workflow as the cross-epic acceptance test:

**Lentivector purification experiment Notebook**

The Notebook contains a Sheet combining:

- Sample Model Records;
- an Upstream Results Dataset;
- a Purification Results Dataset;
- a local Observation column;
- a calculated Recovery column.

The completed core workflow should allow the scientist to:

1. insert the Sheet into the Notebook;
2. bind the Sample Model and two Datasets;
3. use Sample ID as row identity;
4. join both Datasets by Sample;
5. paste substantial data;
6. link existing Samples;
7. create missing Samples inline and in bulk;
8. calculate Recovery;
9. add local observations;
10. edit source-backed values with correct write-back;
11. filter, sort and save a View;
12. inspect provenance and API identity;
13. reload with no hidden client-only truth;
14. pin/freeze the structured evidence for submission/review.

This workflow is a higher priority than adding unrelated specialist screens.

# Work intentionally de-emphasised during early Core epics

Until CORE-01 through CORE-04 are substantially proven, avoid broad feature expansion in:

- Analysis Studio;
- Planner;
- Calendar;
- Instrument Monitor;
- Report Builder;
- Storage/freezer;
- Plate Designer;
- new dashboard surfaces.

Keep existing work. Bug fixes, security fixes and changes that converge these surfaces onto core primitives are appropriate.

The open immutable-analysis work should be reviewed against Dataset versions, future Pipeline Runs and Notebook frozen evidence before it is allowed to establish a separate long-term transformation architecture.

# Operational hardening

Security, recovery, accessibility and performance are continuous requirements rather than a final polish phase.

Maintain and extend:

- backup/restore and migration rehearsal;
- observability and audit-event integrity;
- threat-model/security review and dependency scanning;
- browser/accessibility/performance tests;
- tenancy isolation;
- reproducible environment promotion;
- large-Dataset and bulk-operation testing as the Core programme introduces them.

# Delivery rhythm

Each epic is delivered as narrow end-to-end slices with migrations, API/RLS contract tests, UI interaction tests and a demonstrable workflow.

A capability is not complete because a table, component or route exists. The authoritative data contract, permissions, failure behaviour and reconstruction/provenance story must work from a fresh environment.

When implementation evidence settles a durable deferred contract, record it in `docs/decisions/` before later work depends on it.

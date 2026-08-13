# CORE-02 — Dataset Primitive

**Status:** Planned / substantially elaborated  
**Refinement gate:** CORE-01.7 must review this file against the implemented common schema kernel before CORE-02.1 begins.

## Epic goal

Make Dataset the durable, API-addressable rectangular data object independent of Sheet presentation.

## Epic invariants

- Dataset is not Sheet.
- Dataset Schema uses CORE-01 field semantics.
- Row and field identities are stable and independent of visual position/labels.
- PostgreSQL remains authoritative.
- Bulk operations are first-class; row-at-a-time HTTP loops are not the primary write path.
- Physical storage must support RLS, schema evolution, API access and representative scientific scale.
- Do not design Dataset solely around Handsontable requirements.

---

# CORE-02.1 — Audit current scientific table/Dataset persistence

**Blocked by:** CORE-01.7.

## Goal

Document the current physical/logical persistence used by scientific Sheets/tables/Dataset Explorer and identify what can be retained for the Dataset primitive.

## Deliverables

Create `docs/core/audits/DATASET_PERSISTENCE_AUDIT.md` covering:

- current tables/migrations/types/RPCs;
- row and column identity;
- schema representation;
- data writes and bulk behaviour;
- RLS/API exposure;
- formula dependencies/result caches;
- Dataset Explorer assumptions;
- scale/performance assumptions;
- keep/adapt/deprecate recommendation.

## Data/API changes

None.

## Do not

Create migrations or pick the final physical strategy in this task.

## Exit gate

The Dataset storage ADR can be written from evidence rather than assumptions.

---

# CORE-02.2 — Decide Dataset physical storage and versioning

**Blocked by:** CORE-02.1.

## Goal

Settle the durable storage/versioning strategy before implementation.

## Deliverables

ADR(s) covering:

- Dataset metadata representation;
- Dataset Schema/version representation;
- physical row/value storage strategy;
- stable row/field IDs;
- schema migration/version policy;
- PostgREST/API discoverability;
- RLS;
- large-data query strategy;
- formula/Pipeline reference implications.

Compare realistic alternatives rather than selecting the cleanest-looking schema by default.

## Must preserve

Existing calculation identity/provenance guarantees and workspace isolation.

## Do not

- use one JSON blob per Dataset as the sole durable data representation without strong evidence;
- create arbitrary per-user SQL execution;
- make visual row number the row ID;
- make schema labels the field ID.

## Exit gate

A reviewed ADR gives CORE-02.3 a concrete migration target.

---

# CORE-02.3 — Implement Dataset and Dataset Schema metadata

**Blocked by:** CORE-02.2.

## Goal

Add durable Dataset/Dataset Schema identities and lifecycle metadata using the selected architecture.

## Deliverables

- additive migrations;
- RLS;
- Drizzle/domain types;
- PostgREST resources/views as appropriate;
- create/read/update/archive semantics;
- schema version binding;
- tests for workspace isolation and lifecycle.

## Do not

Build Sheet UI in this task.

## Exit gate

A Dataset and its Schema can exist and be addressed through the authenticated API without any Sheet.

---

# CORE-02.4 — Implement stable rows, fields and typed validation

**Blocked by:** CORE-02.3.

## Goal

Persist Dataset rows/values with stable row/field identities and server-authoritative validation using CORE-01 semantics.

## Deliverables

- row identity implementation;
- typed field/value validation;
- required/category/unit/Record-reference validation as supported by kernel;
- stable structured error model suitable for grid rendering;
- API tests.

## Must preserve

Formula/dependency compatibility identified in CORE-02.1/02.2.

## Do not

Treat a failed client validator as sufficient enforcement.

## Exit gate

Valid rows persist; invalid typed values are rejected with precise field/row errors; IDs survive reorder/rename operations.

---

# CORE-02.5 — Add atomic bulk validate/commit operations

**Blocked by:** CORE-02.4.

## Goal

Provide efficient database-aware operations for spreadsheet paste/import and later bulk Record/Sheet workflows.

## Deliverables

- controlled validate operation;
- commit operation with clear atomicity policy;
- structured per-row/per-field errors;
- duplicate/conflict handling;
- bounded request sizes and safe retry/idempotency behaviour;
- tests using realistic multi-row payloads.

## Do not

Implement bulk paste as hundreds of independent browser CRUD calls.

## ADR trigger

Required if partial-success versus all-or-nothing semantics are not already settled by CORE-02.2.

## Exit gate

A client can validate and commit a substantial Dataset batch efficiently and receive actionable errors.

---

# CORE-02.6 — Query, filtering and large-data behaviour

**Blocked by:** CORE-02.4.

## Goal

Make Dataset query semantics suitable for future compositional Sheets and Dataset Explorer at scale.

## Deliverables

- paged/windowed query contract;
- server-side filter/sort contract for supported field types;
- explicit total/query state where practical;
- indexes justified by representative queries;
- performance fixture/data generator;
- baseline performance evidence.

## Must preserve

Correctness and complete-data semantics. The UI must be able to distinguish loaded window from whole Dataset.

## Do not

Require the browser to load the full Dataset for routine sorting/filtering.

## Exit gate

Representative large Dataset reads/filter/sort operations meet documented baseline expectations and expose semantics CORE-03 can consume.

---

# CORE-02.7 — Adapt Dataset Explorer to the Dataset primitive

**Blocked by:** CORE-02.5, CORE-02.6.

## Goal

Make the existing Dataset Explorer a consumer of the canonical Dataset API rather than an independent data concept.

## Deliverables

- existing useful Explorer behaviours retained where compatible;
- query/schema/lineage UI uses canonical Dataset identity;
- editing only where the Dataset API explicitly supports it;
- no parallel client-side schema truth;
- focused UI/API tests.

## Do not

Expand Analysis Studio or add unrelated Explorer features.

## Exit gate

Dataset Explorer reads canonical Dataset objects and does not require a parallel persistence contract.

---

# CORE-02.8 — Epic proof and CORE-03 refinement

**Blocked by:** CORE-02.3 through CORE-02.7.

## Goal

Prove Dataset exists independently and refine compositional Sheet tasks using implementation evidence.

## Deliverables

- create Dataset + Schema through supported API/UI path;
- bulk write realistic data;
- query/filter/sort it;
- prove stable row/field identity;
- prove RLS/isolation;
- demonstrate Dataset Explorer consumption;
- `pnpm validate` and fresh DB proof;
- refine `tasks/CORE-03.md` to implementation-ready detail;
- update `NEXT.md` to CORE-03.1.

## Exit gate

Dataset is a durable rectangular-data primitive independent of Sheet presentation, with typed schema, bulk operations, stable identity, API access and evidence of acceptable representative performance.

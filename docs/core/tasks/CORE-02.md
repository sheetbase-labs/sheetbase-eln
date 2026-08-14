# CORE-02 — Dataset Primitive

**Status:** In progress — CORE-02.3–02.5 hardening
**Refinement evidence:** CORE-01.7 confirmed that Models and Dataset Schemas
already consume the shared `FieldDefinition` kernel. CORE-02 therefore starts
with persistence evidence, not another field-type design.

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

**Blocked by:** Nothing.
**Status:** Complete (2026-08-14).

## Goal

Document the current physical/logical persistence used by scientific Sheets/tables/Dataset Explorer and identify what can be retained for the Dataset primitive.

## Why

CORE-01 settled shared field meaning but intentionally did not select Dataset
physical storage. The storage/versioning decision must account for the current
scientific-table write path, formula provenance, RLS, and Explorer behaviour.

## Existing implementation to inspect

- `src/db/schema.ts` and migrations `0013_data_002_scientific_tables.sql`,
  `0014_data_003_scientific_rest.sql`, `0035_sci_010_dataset_schema_registry.sql`,
  and `0036_sci_011_schema_relationships.sql`;
- `src/lib/scientific-sheet-data.ts`, `src/lib/dataset-schema-data.ts`,
  `src/lib/dataset-explorer-data.ts`, and formula/dependency modules;
- controlled scientific-table RPCs, RLS policies, and PostgREST resources;
- `src/components/sheet/`, Dataset Explorer routes/components, and focused DB
  tests including `tests/db/scientific-*.test.ts` and
  `tests/db/dataset-schema-registry.test.ts`.

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

## Must preserve

- CORE-01 `FieldDefinition` identity and semantics;
- current workspace isolation and server-authoritative validation;
- formula/dependency identity and reconstructable evidence;
- existing scientific Sheets while a later migration path is selected.

## Do not

Create migrations or pick the final physical strategy in this task.

## Tests / evidence

- Reproduce representative create/edit/schema-evolution/formula flows against
  the existing DB tests and record their current contracts in the audit.
- Document actual scale fixtures and query behaviour; state when evidence is
  absent rather than guessing.
- No migration or implementation validation is required beyond the focused
  evidence used to ground the audit.

## ADR trigger

CORE-02.2 must record the durable physical-storage/versioning decision after
this audit compares viable alternatives.

## Exit gate

The Dataset storage ADR can be written from evidence rather than assumptions.

## Initial implementation evidence (not exit-gate evidence)

- Added `docs/core/audits/DATASET_PERSISTENCE_AUDIT.md`, grounded in current
  migrations, schema, RPC/RLS, formulas, Explorer/API consumers and tests.
- The audit identifies generated table-per-sheet persistence as a compatibility
  source rather than the independent Dataset primitive, and records the
  identity, versioning, query and migration constraints for CORE-02.2.

---

# CORE-02.2 — Decide Dataset physical storage and versioning

**Blocked by:** CORE-02.1.
**Status:** Complete (2026-08-14), subject to the reopened CORE-02.6 evidence gate.

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

## Initial implementation evidence (not exit-gate evidence)

- Added ADR 0037, selecting typed relational row/value storage and explicit
  immutable Dataset snapshots with stable Dataset, Schema, row, field and
  version IDs.
- The ADR compares typed tables, EAV, JSONB and the selected hybrid against
  versions, schema evolution, quantity queries, bulk/RLS/API, formula
  compatibility, migration and future compositional reads.

---

# CORE-02.3 — Implement Dataset and Dataset Schema metadata

**Blocked by:** CORE-02.2.
**Status:** Complete (2026-08-14).

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

## Completion evidence

- Added `dataset_schema_definitions`, immutable `dataset_schema_versions`,
  canonical version fields and independently addressable `datasets` in
  migrations `0062_shallow_energizer.sql` and `0063_productive_the_captain.sql`.
- Added workspace RLS and schema-capability-protected metadata writes.
- Migration `0067_core_025_dataset_integrity_hardening.sql` enforces matching
  workspaces for Dataset/Schema, Dataset/project and Dataset/row bindings, and
  makes active/retired Schema Versions and their fields immutable.
- `tests/db/datasets.test.ts` proves authenticated independent Dataset access,
  workspace isolation, cross-workspace relationship rejection and published
  Schema Version immutability.

---

# CORE-02.4 — Implement stable rows, fields and typed validation

**Blocked by:** CORE-02.3.
**Status:** Complete (2026-08-14).

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

## Completion evidence

- Added `dataset_rows` and typed `dataset_row_values` in migration
  `0064_neat_mimic.sql`, retaining stable row/field IDs and indexed numeric,
  category and reference access paths.
- Migrations `0067` and `0069_core_024_dataset_canonical_values.sql` enforce
  canonical Schema publication metadata, all supported scalar slots and
  constraints, required/default behavior, embedded active category options,
  compatible active Model Record references, retired fields and physical
  ordered `many` cardinality.
- Authenticated direct row/value mutation is revoked; controlled validation
  returns stable row-index/row-ID/field-ID error codes.
- `tests/db/datasets.test.ts` proves scalar/category/reference/default/required
  success and failure matrices, stable IDs, ordered replacement and workspace
  isolation against a freshly migrated database.

---

# CORE-02.5 — Add atomic bulk validate/commit operations

**Blocked by:** CORE-02.4.
**Status:** Complete (2026-08-14).

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

## Completion evidence

- Added `dataset_bulk_commits` and migration
  `0065_core_025_dataset_bulk_operations.sql` with actor-scoped idempotency
  receipts protected by workspace RLS.
- Added `api.validate_dataset_row_batch` and
  `api.commit_dataset_row_batch`. The canonical request uses a client-generated
  stable `rowId`, explicit `create`/`update` operation, typed field-ID map, and
  required Dataset/row revisions. Validation is bounded to 1,000 rows and
  returns row-index/row-ID/field-ID errors without mutation.
- Commits revalidate under the Dataset lock, lock existing target rows in UUID
  order, apply no partial batch, increment row/Dataset revisions, and return
  the stored result on an exact idempotent retry. Reusing a key for a different
  request is rejected.
- Migration `0069` closes required/default, category/reference, retired-field,
  `many`, malformed request and global row-ID conflict behavior while
  preserving the bounded atomic/idempotent contract.
- `tests/db/datasets.test.ts` covers typed validation, all-or-nothing writes,
  global and in-batch duplicates, idempotent retries, key-reuse rejection, row
  revision conflicts, actionable error context and workspace isolation.
- Fresh focused DB validation passes 19/19.

---

# CORE-02.6 — Query, filtering and large-data behaviour

**Blocked by:** CORE-02.4.
**Status:** In progress — ADR 0037 composition, aggregation and bulk scale evidence missing.

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

## Current evidence

- Added `api.query_dataset_rows(dataset_id, query, limit, offset)` in migration
  `0066_core_026_dataset_query.sql`. It returns stable row/field IDs, typed
  values, a bounded window (1–1,000 rows), authoritative `totalCount`, offset,
  `hasMore`, and Dataset revision.
- Filters and sorts use only active canonical field IDs; supported typed
  equality/range predicates are server-validated. The caller never supplies
  SQL, labels, generated resource names, or physical column names.
- Added date/timestamp value indexes and
  `scripts/benchmark-dataset-query.ts`, a reproducible 100k-row/10-field
  performance fixture. Evidence is recorded in
  `audits/DATASET_QUERY_PERFORMANCE.md`: a 10,000-row numeric-filter match,
  date sort, and 200-row window measured 79.6 ms then 67.4/65.5 ms locally.
- `tests/db/datasets.test.ts` proves typed range filtering, sorting, bounded
  windows, totals, unsupported-operator rejection, `many` membership and
  deterministic ordinal-first sorting.
- The current fixture does not yet cover the required 80k-row second Dataset,
  stable Sample-reference composition, 12-field projection, numeric aggregate,
  or substantial bulk insert/update measurements. The exit gate remains open.

---

# CORE-02.7 — Adapt Dataset Explorer to the Dataset primitive

**Blocked by:** CORE-02.5, CORE-02.6.
**Status:** Complete (2026-08-14).

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

## Completion evidence

- `fetchDatasetSummaries` now reads canonical `api.datasets` and immutable
  Schema Version fields; Explorer identity, columns, filters and sorting use
  Dataset/field UUIDs rather than generated resource/column names.
- Data windows use only `api.query_dataset_rows`. The existing dense,
  virtualised `RegistryComposition` is retained, while chart/schema tabs state
  that they are unavailable for canonical Datasets rather than silently falling
  back to legacy Sheet-owned persistence.
- `src/lib/dataset-explorer-data.test.ts` covers canonical summaries and RPC
  paging/filter/sort translation; focused data and DB suites pass.

---

# CORE-02.8 — Immutable Dataset Versions and snapshot/query semantics

**Blocked by:** CORE-02.3 through CORE-02.6.
**Status:** Complete (2026-08-14).

## Goal

Implement explicit meaningful-boundary snapshots rather than reconstructing
state from audit history.

## Deliverables

- stable Dataset Version identity pinned to its Schema Version;
- immutable copied rows and typed values retaining stable Dataset/row/field IDs;
- authenticated snapshot creation and historical query API;
- DB-level update/delete protection for immutable evidence;
- tests proving later live edits do not change historical state.

## Exit gate

An explicit snapshot remains queryable and semantically pinned after live
Dataset edits, without audit-log reconstruction.

## Completion evidence

- Migration `0068_core_028_dataset_versions.sql` adds Schema-Version-pinned
  Dataset Versions, copied stable rows/typed values, workspace RLS,
  authenticated snapshot/query RPCs and DB-level update/delete protection.
- Migration `0069` reconstructs historical scalar/`many` values from pinned
  schema cardinality and preserved ordinals.
- `tests/db/datasets.test.ts` proves later live scalar and ordered `many`
  replacement cannot alter historical query results, including a one-item
  `many` value remaining an array.

---

# CORE-02.9 — Epic proof and CORE-03 refinement

**Blocked by:** CORE-02.3 through CORE-02.8.
**Status:** Not started.

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

## Completion evidence

- Fresh migrate and demo seed pass with the complete Core-02 migration chain.
- `pnpm validate` passes: 141 test files / 1,704 tests, lint with 19 existing
  warnings and no errors, typecheck, formatting, and production build.
- Canonical Dataset DB tests prove typed values, bulk atomicity/idempotency,
  optimistic concurrency, range query/filter/sort windows and workspace
  isolation. Explorer tests prove it requests only canonical resources/RPCs.
- CORE-03 remains implementation-ready as written; no refinement changed its
  Definition/Instance contracts. Its initial audit is the next task.

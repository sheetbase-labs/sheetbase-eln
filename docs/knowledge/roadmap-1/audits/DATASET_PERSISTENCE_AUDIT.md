# Dataset persistence audit

**CORE-02.1 — completed 2026-08-14**

## Conclusion

The current scientific-table implementation proves important Dataset behaviour,
but is not an independent Dataset primitive. A scientific table is owned by a
single Sheet block and Record, and the Explorer treats that table as a Dataset.
Dataset Schemas are a reusable registry layered over those sheet-owned tables.

CORE-02 should preserve UUID identity, PostgreSQL validation, RLS, optimistic
concurrency, transactional bulk writes, formula identity, and schema semantics.
It must introduce independently addressable Dataset identity, canonical row and
field access, and meaningful immutable Dataset Versions. Generated tables and
direct physical-resource Explorer reads must not become the canonical API.

## Implementation inspected

- `src/db/schema.ts` for Dataset Schema, scientific table/column, formula,
  dependency and result-cache contracts.
- `drizzle/0013_data_002_scientific_tables.sql`,
  `0014_data_003_scientific_rest.sql`, and `0015_sheet_002_insert.sql` for
  generated tables, typed DDL, RLS, row triggers and the active bulk API.
- `drizzle/0017_calc_002_formula_persistence.sql`,
  `0019_calc_004_trusted_result_cache.sql`,
  `0035_sci_010_dataset_schema_registry.sql`, and
  `0036_sci_011_schema_relationships.sql` for provenance and schema binding.
- `src/lib/scientific-sheet-data.ts`, `src/lib/dataset-schema-data.ts`,
  `src/lib/dataset-explorer-data.ts`, `src/routes/datasets.tsx`, and charts.

## Current storage and identity

`api.scientific_tables` is a catalog row with UUID, workspace, owning
`record_id`, required unique `block_id`, generated `resource_name`, schema
version and optional Dataset Schema binding. `api.create_scientific_table`
creates a physical `api.sheet_<generated>` relation. Rows have UUID `id`,
optimistic `version`, timestamps, workspace/audit fields and formula markers.

`api.scientific_columns` gives each physical generated column a UUID. Its
generated `field_name` is a storage locator, not semantic identity. The column
compiler emits PostgreSQL types, defaults and checks; category options retain
their own UUID identity.

`api.dataset_schemas` and `api.dataset_schema_fields` supply workspace registry
rows, revision number, stable field UUIDs and slugs. Published revisions can
instantiate a sheet-owned scientific table. Each revision is presently its own
schema row; this needs adaptation to ADR 0021's stable schema identity plus
immutable schema-version model.

Rows already survive sort/filter/reload through UUID IDs. Formula calculation
order is stable `(created_at, id)`. Column/field labels and display order are
mutable. These identity guarantees should be kept.

## Writes, RLS and formulas

`apply_scientific_row_edits` and active successor
`apply_scientific_row_changes` accept stable row/column IDs plus expected row
and schema versions. PostgreSQL validates all requested cells before committing
the batch, returns structured row/column errors, locks deterministically, and
does not partially apply invalid batches. Row triggers emit durable events and
protect formula-owned cells.

Scientific metadata, generated rows, formulas and result views use
workspace-aware RLS. Browser traffic uses `/api/db`; external credentials use
scientific read/write/schema scopes for generated resources. Dataset Schema
API-client policies are less consistently scope-aware and must converge on one
canonical Dataset policy.

Formula definitions target stable `(table_id, row_id, column_id)` tuples;
dependencies use the same durable source identities. Formula result cache is
explicitly non-authoritative. The transition must retain resolution of existing
scientific identities while new Dataset formulas bind to Dataset/row/field/
version identity. Audit events cannot substitute for Dataset Versions.

## Explorer and scale evidence

Explorer currently reads generated relations directly by `resource_name`, using
physical field names for exact-equality filtering and sorting. It uses offset
pages, first-page exact count, a 100-row maximum and up to eight filters.
Sort/filter are server-owned; grouping covers only loaded rows. Charts can load
a bounded full table. `query_dataset` projects schema-field slugs but is a
schema-wide query, not a canonical Dataset query API.

The demo stability table has eight rows. `pnpm db:seed:month` adds broader
operational fixtures but no representative large Dataset benchmark. API tests
prove paging and the `query_dataset` 5,000-row ceiling, not execution-time
baselines. CORE-02.6 must add deterministic performance fixtures and measured
query/filter/sort evidence.

## Keep, adapt and retire

| Direction            | Contracts                                                                                                                                                                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep                 | UUID row/column identities, field lifecycle, typed PostgreSQL validation, RLS/API proxy, optimistic versions, deterministic locking, atomic error shape, category identities, formula dependency/cache contracts, schema projection and virtualised Explorer UI.              |
| Adapt                | Scientific table catalog as migration source; Dataset Schema revisions as stable identity plus immutable versions; formula bindings; schema capabilities/API scopes; Explorer URL/cache/view/chart query identity.                                                            |
| Retire from new APIs | Sheet-block ownership as Dataset identity, `resource_name` and `field_name` as public identity, direct physical Explorer reads, table-local columns as permanent Dataset schema truth, edit-only bulk RPC for new callers, and audit history as a Dataset Version substitute. |

## Tests consulted

- `tests/db/scientific-tables.test.ts`
- `tests/db/scientific-rest.test.ts`
- `tests/db/scientific-table-isolation.test.ts`
- `tests/db/scientific-table-evolution.test.ts`
- `tests/db/formula-persistence.test.ts`
- `tests/db/dataset-schema-registry.test.ts`
- `tests/db/schema-relationships.test.ts`
- `tests/api/dataset-explorer.test.ts`
- `src/lib/dataset-explorer-data.test.ts`
- `src/routes/datasets.test.tsx`

## CORE-02.2 input

The ADR must compare typed table-per-Dataset continuation, canonical relational
row/value storage, and JSONB-row storage with extracted indexes. It must weigh
dynamic DDL/PostgREST churn, validation, query/index behaviour, formula
migration, snapshots, RLS, and retention of existing sheet tables. The evidence
supports a canonical Dataset persistence model with compatibility adapters.

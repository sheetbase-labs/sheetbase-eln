# ADR 0037 — Canonical Dataset storage and versioning

- Status: Accepted
- Date: 2026-08-14
- Related: ADRs 0021, 0025, 0026; CORE-02.1 audit

## Decision

CORE-02 uses a typed relational row/value hybrid. It gives Dataset, Dataset
Schema, Dataset Schema Version, Row, Field and Dataset Version stable UUIDs.
It does not expose generated table/column names and does not make a Dataset
dependent on a Sheet, Record or Project placement.

Live rows use `dataset_rows`; non-null values use `dataset_row_values` keyed by
stable `(row_id, field_id)`. Values have mutually exclusive typed slots for
text, integer, numeric, boolean, date, timestamp, category-option UUID and
reference UUID. PostgreSQL validates the slot and value against the canonical
FieldDefinition at the Dataset's Schema Version. Null is absence of a value
row. Governed quantities persist only in their declared storage unit.

Meaningful snapshots copy rows and typed values into immutable
`dataset_version_rows` and `dataset_version_values`, recording the exact
Dataset Schema Version. Snapshot creation is proportional to non-null values,
not audit-log replay; it is intentionally a substantial operation reserved for
explicit snapshots, submission evidence, Pipeline boundaries, publication and
schema migrations. Versions use the same typed query path and remain queryable
after live edits proceed. Audit history never reconstructs a Dataset Version.

Schema has stable conceptual identity and immutable version rows. An optional
field addition creates a compatible new Schema Version: old values remain and
the live Dataset can explicitly advance. A meaningful `Titre` semantic change
is breaking: it creates a new Field Definition/Schema Version and needs an
explicit typed transformation before the live Dataset advances. Old Dataset
Versions continue to query their original fields and units without silent
reinterpretation.

Bulk RPCs accept stable Dataset/Schema Version/row/field IDs, expected
revisions and an idempotency key. They validate set-based where possible, lock
rows by UUID deterministically, return structured row/field errors and commit
atomically. RLS covers Datasets, live values, Versions and snapshot values by
workspace/Dataset permission; schema capabilities remain distinct from Dataset
write authority.

Existing scientific tables remain compatibility infrastructure. Migration is
incremental through explicit legacy table/row/column to Dataset/row/field
mappings. Existing Sheets and formulas continue resolving legacy IDs while new
canonical APIs use only stable Dataset identities. Formula migration preserves
historical resolution through those mappings.

## Alternatives compared

| Criterion                                     | Typed table/Dataset          | Untyped EAV             | JSONB row                      | Selected typed hybrid                         |
| --------------------------------------------- | ---------------------------- | ----------------------- | ------------------------------ | --------------------------------------------- |
| Typed numeric/quantity filters and aggregates | Native, but dynamic DDL      | Cast-heavy              | Expression casts/indexes       | Native numeric slot and partial indexes       |
| Dataset Version                               | Copy physical relation       | Copy values             | Copy documents                 | Copy typed snapshot rows/values               |
| Historical Version query                      | Physical relation discovery  | Generic but weak typing | Generic but cast-heavy         | Same stable typed query API                   |
| Schema evolution                              | DDL per Dataset              | Metadata only           | Metadata only                  | Explicit Schema Versions and transformations  |
| Bulk writes                                   | Proven, DDL/cache churn      | Write amplification     | Compact but complex validation | Set-based typed validation/commit             |
| RLS/API stability                             | Leaks generated resources    | Stable RPC possible     | Stable RPC possible            | Stable Dataset/Schema/row/field/version API   |
| 100k/80k composition                          | Dynamic SQL across relations | Many joins/casts        | JSON extraction joins          | Indexed reference/category/date/numeric joins |
| Formula migration                             | Existing legacy model        | Full adapter            | Full adapter                   | Direct legacy identity mapping                |
| Operations                                    | DDL/policy/cache per Dataset | Moderate                | Moderate                       | Predictable relational indexes                |

Typed per-Dataset tables preserve useful PostgreSQL types but repeat current
Sheet coupling and DDL/PostgREST cache churn. Untyped EAV and JSONB simplify
schema representation but compromise quantity ranges, aggregates and indexes.
The selected hybrid preserves schema flexibility and stable identity while
keeping `titre > 1e8`, `avg(titre)`, percentile/min/max and indexed ranges
native PostgreSQL operations.

## Query and benchmark requirements

CORE-02.6 must seed deterministic 100k-row and 80k-row Datasets with 10–30
mixed fields. It must measure a Sample-reference join, QC filter, 12-field
projection, date sort and 200-row window, along with numeric range/aggregate,
bulk inserts and updates. Indexes are selected from those measurements, not
hypothetical scale alone.

## Consequences

- CORE-02.3 adds Dataset/Schema metadata and RLS.
- CORE-02.4 adds typed live rows/values and validation.
- CORE-02.5 adds idempotent atomic bulk validation/commit.
- CORE-02.6 adds query indexes, fixture and measured baselines.
- Current scientific tables are retained and adapted, not redefined as the
  canonical Dataset primitive.

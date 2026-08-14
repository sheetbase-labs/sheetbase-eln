# Sheetbase Core — Current Work

> **Implementation agents start here.**

## Programme

**Core Data Workspace**

## Active task

**CORE-02.6 — Dataset query, composition and scale evidence**

Task: [`tasks/CORE-02.md`](./tasks/CORE-02.md#core-026--query-filtering-and-large-data-behaviour)

## Completed in this PR

- CORE-01.1 — current field/schema audit
- CORE-01.2 — executable canonical `FieldDefinition` contract and tests
- CORE-01.3 — Model fields converged on the canonical kernel
- CORE-01.4 — Dataset Schema fields defined through the canonical kernel
- CORE-01.5 — Field rendering/editor selection converged on canonical semantics
- CORE-01.6 — Initial server-enforced schema capability boundary
- CORE-01.7 — Epic proof and CORE-02 hand-off
- CORE-02.1–02.5 — Dataset persistence, metadata, typed rows and controlled
  bulk validation/commit
- CORE-02.7 — canonical Dataset Explorer consumption
- CORE-02.8 — immutable Dataset Version snapshot/query semantics
- product/architecture reset and accepted ADRs 0020–0026

## Required reading

1. [`PRODUCT_CORE.md`](./PRODUCT_CORE.md)
2. [`CORE_ARCHITECTURE.md`](./CORE_ARCHITECTURE.md)
3. [`CORE_MIGRATION.md`](./CORE_MIGRATION.md)
4. [`tasks/CORE-02.md`](./tasks/CORE-02.md)
5. [`audits/DATASET_QUERY_PERFORMANCE.md`](./audits/DATASET_QUERY_PERFORMANCE.md)
6. [`../decisions/0037-dataset-primitive-storage-and-versioning.md`](../decisions/0037-dataset-primitive-storage-and-versioning.md)
7. `scripts/benchmark-dataset-query.ts`
8. migrations `0064` through `0069` and `tests/db/datasets.test.ts`

## Implement now

Close the remaining ADR 0037 evidence gate before CORE-02 epic proof. Expand
the deterministic fixture to cover a 100k-row Dataset composed with an
80k-row Dataset through stable Sample references, 10–30 mixed fields and a
12-field projected window. Measure numeric range and aggregation, QC/category
filtering, date sort, paging/windowing, and substantial bulk inserts and
updates. Record fixture shape, query plans, timings, thresholds and justified
indexes. Re-run the canonical Dataset Explorer contract against the final
query behavior.

This is **real production coding**, not another architecture pass.

The next unit may add the smallest query/RPC/index changes required by measured
evidence, including numeric aggregation. It must not begin Sheet composition;
the 100k/80k join is Dataset-layer evidence for the future consumer contract.

## Do not

- do not redesign the architecture already settled by ADRs 0020–0026;
- do not begin compositional Sheet work yet;
- do not build the full unit-conversion or vocabulary-management product yet;
- do not weaken RLS/server validation;
- do not broaden paused specialist workspaces.

## Hand-off evidence

Migration `0069_core_024_dataset_canonical_values.sql` closes canonical
publication/value/default/reference/category/required/cardinality enforcement,
ordered `many` persistence, cardinality-aware live/version reads, membership
filtering and deterministic ordinal-first sorting. The controlled bulk path
retains atomicity, revisions, deterministic locks, bounded batches and
idempotency. Direct authenticated row/value mutation remains revoked.

Controller verification after fresh setup/migration:

- `tests/db/datasets.test.ts`: 19/19;
- Dataset Explorer + `FieldDefinition`: 27/27;
- typecheck and formatting pass;
- lint: no errors, 19 existing warnings.

The existing 100k/10-field query measurement is useful baseline evidence but
does not satisfy ADR 0037's required 100k+80k composition, aggregation or bulk
write scenarios. Do not begin CORE-03 until CORE-02.6 and CORE-02.9 pass.

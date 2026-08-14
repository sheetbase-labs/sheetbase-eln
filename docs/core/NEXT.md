# Sheetbase Core — Current Work

> **Implementation agents start here.**

## Programme

**Core Data Workspace**

## Active task

**CORE-02.9 — Epic proof and CORE-03 refinement**

Task: [`tasks/CORE-02.md`](./tasks/CORE-02.md#core-029--epic-proof-and-core-03-refinement)

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
- CORE-02.6–02.7 — representative scale evidence and canonical Dataset
  Explorer consumption
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

Run CORE-02.9's epic-wide fresh proof: exercise the supported Dataset/Schema
creation path, realistic controlled bulk writes, canonical query/filter/sort,
stable identity, RLS isolation, immutable Versions and Dataset Explorer
consumption. Run the full validation gate and refine CORE-03 only where the
completed implementation evidence requires it. Do not begin CORE-03
implementation in the CORE-02.9 unit.

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

CORE-02.6 now passes ADR 0037's deterministic 100k+80k scale gate. The final
fresh PostgreSQL 18.6 run measured the authenticated numeric/date window at
97.6 ms cold-ish and 72.0/72.1 ms warm; the 80,000-match stable Sample join at
36.4 ms; the 12-field projection at 33.2 ms; the 20,000-value aggregate at
56.0 ms; and canonical 1,000-row create/update commits at 721.0/365.7 ms.
Focused Dataset DB tests pass 19/19 and Dataset Explorer + FieldDefinition
tests pass 27/27. CORE-02.9 remains open; do not begin CORE-03 until it passes.

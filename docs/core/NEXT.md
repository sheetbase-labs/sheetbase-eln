# Sheetbase Core — Current Work

> **Implementation agents start here.**

## Programme

**Core Data Workspace**

## Active task

**CORE-02.3–02.5 — Dataset integrity and canonical validation hardening**

Task: [`tasks/CORE-02.md`](./tasks/CORE-02.md#core-023--implement-dataset-and-dataset-schema-metadata)

## Completed in this PR

- CORE-01.1 — current field/schema audit
- CORE-01.2 — executable canonical `FieldDefinition` contract and tests
- CORE-01.3 — Model fields converged on the canonical kernel
- CORE-01.4 — Dataset Schema fields defined through the canonical kernel
- CORE-01.5 — Field rendering/editor selection converged on canonical semantics
- CORE-01.6 — Initial server-enforced schema capability boundary
- CORE-01.7 — Epic proof and CORE-02 hand-off
- product/architecture reset and accepted ADRs 0020–0026

## Required reading

1. [`PRODUCT_CORE.md`](./PRODUCT_CORE.md)
2. [`CORE_ARCHITECTURE.md`](./CORE_ARCHITECTURE.md)
3. [`CORE_MIGRATION.md`](./CORE_MIGRATION.md)
4. [`audits/FIELD_SCHEMA_AUDIT.md`](./audits/FIELD_SCHEMA_AUDIT.md)
5. [`tasks/CORE-01.md`](./tasks/CORE-01.md)
6. ADRs `0020` through `0026` in `docs/decisions/`
7. `src/lib/field-definition.ts` and its tests
8. the actual existing Model DB/API/UI implementation identified by the audit

## Implement now

Close the reviewed CORE-02 integrity and validation gates before starting
CORE-03. PostgreSQL must enforce workspace-consistent Dataset relationships,
immutable published Schema Versions, canonical `FieldDefinition` validation,
required-field completeness at the controlled bulk commit boundary, and
physical `many` cardinality. Add and implement an explicit immutable Dataset
Version snapshot task. Expand the ADR 0037 performance fixture to the required
100k/80k composition and bulk scenarios.

This is **real production coding**, not another architecture pass.

Key targets:

- make no data/API changes in this audit;
- map current ownership and compatibility risks precisely;
- use the audit to implement CORE-03.2 without rediscovery.

## Do not

- do not redesign the architecture already settled by ADRs 0020–0026;
- do not begin compositional Sheet work yet;
- do not build the full unit-conversion or vocabulary-management product yet;
- do not weaken RLS/server validation;
- do not broaden paused specialist workspaces.

## Corrected hand-off

`0065_core_025_dataset_bulk_operations.sql` provides a useful initial bulk
commit slice, but CORE-02.5 remains in progress because it does not yet cover
all canonical semantics or prevent direct mutation-path bypass. It adds bounded
(1–1,000 row) typed validate/commit RPCs. Client-generated stable
row UUIDs support retry-safe creates; updates require row revisions. Commits
are all-or-nothing, lock target rows deterministically, increment Dataset and
row revisions, and persist actor-scoped idempotency receipts. Structured
row/field errors are returned without writing invalid batches.

Focused DB validation: `pnpm exec vitest run --config vitest.db.config.ts
tests/db/datasets.test.ts` (5/5).

`0066_core_026_dataset_query.sql` provides
typed field-ID filtering/sorting, bounded windows and authoritative totals for
canonical Dataset rows. The reproducible 100k-row/10-field fixture records a
10,000-match, 200-row window in 65.5–79.6 ms locally; see
`audits/DATASET_QUERY_PERFORMANCE.md`.

Explorer work exists but cannot close CORE-02.7 until the canonical write and
query contracts are hardened. It lists canonical Datasets and Schema Version
fields, and reads page/filter/sort windows exclusively through
`query_dataset_rows`; it deliberately does not fall back to generated legacy
Sheet resources.

Do not begin CORE-03. CORE-02.3 and CORE-02.4 are reopened; CORE-02.5 is the
active hardening slice; CORE-02.6 requires expanded performance evidence; an
explicit Dataset Version task must pass before epic proof.

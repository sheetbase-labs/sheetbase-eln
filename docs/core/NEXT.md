# Sheetbase Core — Current Work

> **Implementation agents start here.**

## Programme

**Core Data Workspace**

## Active task

**CORE-03.3 — Implement Sheet Instance identity and resolved bindings**

Task: [`tasks/CORE-03.md`](./tasks/CORE-03.md#core-033--implement-sheet-instance-identity-and-resolved-bindings)

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
- CORE-02.9 — epic proof, full DB exit gate and CORE-03 refinement
- CORE-03.1 — current Sheet and Template persistence audit
- CORE-03.2 — durable Sheet Definition identity and immutable versions
- product/architecture reset and accepted ADRs 0020–0026

## Required reading

1. [`tasks/CORE-03.md`](./tasks/CORE-03.md), CORE-03.3 only
2. [`PRODUCT_CORE.md`](./PRODUCT_CORE.md), Dataset and Sheet sections
3. [`CORE_ARCHITECTURE.md`](./CORE_ARCHITECTURE.md), sections 4–9 and 12–13
4. [`audits/SHEET_COMPOSITION_AUDIT.md`](./audits/SHEET_COMPOSITION_AUDIT.md)
5. ADRs 0020–0026, especially Definition/Instance identity, lifecycle,
   parameters and Template reuse

## Implement now

Implement durable working Sheet Instance identity and explicitly resolved
bindings as specified by CORE-03.3. Preserve the Definition/Instance boundary,
keep each Instance's local values and working state independent, retain pinned
source Definition/version provenance, and preserve existing scientific Sheets
through the audit's compatibility boundary.

## Do not

- do not implement composition execution, write-back execution or
  materialisation;
- do not share Instance-local values between Instances or silently update
  pinned Definition versions;
- do not equate Notebook block identity with Sheet Instance identity;
- do not redesign architecture already settled by ADRs 0020–0026;
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
tests pass 27/27.

The CORE-02.9 verification pass added migration `0070` so live canonical query
windows contain complete active fields only, plus direct metadata lifecycle and
field-identity proof. Fresh migrate/demo seed and idempotent reseed pass;
`pnpm validate` passes 142 files / 1,718 tests and the production build, with
zero lint errors and 19 existing warnings. Focused Dataset DB tests pass 20/20
and Explorer + FieldDefinition + benchmark-safety tests pass 41/41.

The legacy Scientific Record, submitted-revision and chart fixtures now use the
accepted controlled configuration/revision contracts. Better Auth session
tests inject the same database used for fixture setup. Their focused suites
pass 45/45; the full DB gate passes 51/51 files and 614/614 tests.

CORE-02 is complete. CORE-03.1 is audit-only: canonical Dataset queries expose
bounded complete active-field windows, not public projection/composition/
aggregate APIs; `many` values are ordinal-ordered arrays; joins must bind
stable reference identities; write-back must retain bulk/revision/idempotency
contracts; and the 100k+80k proof does not implement Sheet composition.

CORE-03.1 is complete. `audits/SHEET_COMPOSITION_AUDIT.md` identifies the
current record/block-owned scientific-table cluster, stable table/row/column/
formula identities, browser-only projection state, formula reconstruction and
cache boundaries, Template `{tableId}` copying seam, Explorer handoff mismatch,
and the exact compatibility termination boundary. Representative unit/component
contracts pass 142 files / 1,718 tests; focused scientific-table, Sheet-block,
formula and Template DB contracts pass 4 files / 32 tests. CORE-03.2 starts with
Definition identity/version persistence; it must not rediscover or reinterpret
legacy ownership.

CORE-03.2 is complete. Migrations `0071`/`0072` add workspace-owned Sheet
Definition identities and immutable, explicitly versioned configuration
documents with stable nested UUIDs. Owner/admin controlled RPCs, member-read
RLS, optimistic revisions, monotonic versions, publication/retirement guards,
typed domain parsers and supported data-client contracts are executable.
Focused domain/data, DB/RLS and live API tests pass 59/59, 10/10 and 2/2;
legacy Sheet/Template/formula/frozen-evidence compatibility proof passes 5
files / 40 tests; the full DB gate passes 52 files / 624 tests. All 73
migrations (`0000`–`0072`), fresh demo seed and idempotent reseed pass, and
`pnpm validate` passes 143 files / 1,777 tests plus production build. No existing scientific data was adopted
or migrated, and no ADR was needed. CORE-03.3 starts with independent Instance
identity and resolved binding persistence over these pinned Definition-version
targets.

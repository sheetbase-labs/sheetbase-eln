# Sheetbase Core — Current Work

> **Implementation agents start here.**

## Programme

**Core Data Workspace**

## Active task

**CORE-03.7 — Implement bound columns and provenance inspection**

Task: [`tasks/CORE-03.md`](./tasks/CORE-03.md#core-037--implement-bound-columns-and-provenance-inspection)

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
- CORE-03.3 — durable Sheet Instance identity and resolved binding persistence
- CORE-03.4 — shared typed parameters and binding compatibility
- CORE-03.5 — stable row identity
- CORE-03.6 — constrained multi-source joins
- product/architecture reset and accepted ADRs 0020–0026

## Required reading

1. [`tasks/CORE-03.md`](./tasks/CORE-03.md), CORE-03.7 only plus CORE-03.6 boundary
2. [`PRODUCT_CORE.md`](./PRODUCT_CORE.md), Dataset and Sheet sections
3. [`CORE_ARCHITECTURE.md`](./CORE_ARCHITECTURE.md), sections 4–9
4. ADR 0024 (shared typed parameters), with ADRs 0020–0023 and 0025 for the settled
   identity and compatibility boundaries

## Implement now

Project bound Dataset/Model/relationship fields from the bounded CORE-03.6
composition result. Keep source field, binding and Definition provenance
inspectable without making a rendered grid authoritative.

## Do not

- do not implement local fields, calculations, write-back execution or
  materialisation;
- do not add typed Instance-local-value behavior (CORE-03.8) or broaden the
  completed CORE-03.3 persistence contract without a concrete defect;
- do not silently coerce incompatible bindings or weaken exact version,
  lineage, quantity, vocabulary or stable semantic identity checks;
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
Focused domain/data, DB/RLS and live API tests pass 61/61, 10/10 and 2/2;
legacy Sheet/Template/formula/frozen-evidence compatibility proof passes 5
files / 40 tests; the full DB gate passes 52 files / 624 tests. All 73
migrations (`0000`–`0072`), fresh demo seed and idempotent reseed pass, and
`pnpm validate` passes 143 files / 1,779 tests plus production build. No existing scientific data was adopted
or migrated, and no ADR was needed. CORE-03.3 starts with independent Instance
identity and resolved binding persistence over these pinned Definition-version
targets.

CORE-03.3 is complete. Migrations `0073`/`0074` add independently durable,
workspace-owned Sheet Instances with optional published Definition Version,
project and Notebook context, resolved reference persistence, bounded working
state, optimistic revisions, archive and duplication. Focused domain/data tests
pass 18/18 and focused DB/RLS tests pass 10/10, including executable
cross-workspace/nonexistent context and binding rejection, Dataset Version
ownership, pinned binding/parameter pairs, public nested-state validation,
direct-write denial and exact trigger/helper ACL proof. Focused legacy
compatibility remains 5 files / 40 tests. CORE-03.4 is intentionally not
implemented and now owns typed Parameter compatibility and resolution
provenance.

CORE-03.4 is complete. `src/lib/parameter.ts` is the shared typed Parameter
contract consumed by Sheet Definitions. Migration `0075` adds authoritative
scalar, `Record<Model>`, live Dataset and immutable Dataset Version resolution,
with exact, same-lineage semantic-preservation and stable-field semantic
compatibility plus persisted immutable provenance. One Definition resolves two
compatible Datasets without hard-coded Dataset IDs. Focused domain/data tests
pass 90/90; Definition, Instance and resolver DB/RLS tests pass 31/31; live API
tests pass 3/3; and legacy compatibility remains 5 files / 40 tests. All 76
migrations and the 29-step demo seed pass from fresh, as do formatting,
typecheck, changed source-file lint and `git diff --check`. No conversion,
vocabulary-management, regex-dialect translation, row-identity or composition
execution was added.

CORE-03.6 is complete. Migration `0077` provides an authenticated bounded
virtual composition RPC over active pinned, resolved Dataset bindings. It
executes Definition-declared scalar reference equality joins only, keeps the
root source and joined row/binding/revision/value provenance explicit, returns
left-join unmatched states, and fails duplicate right keys or unsupported,
unresolved and stale state rather than multiplying rows. `sheet-composition-data`
derives the existing `sb-row-v1` keys from the immutable resolved identity
spec; it does not render bound columns. CORE-03.7 owns that projection and UI.
The focused DB composition contract passes 3/3 after migration `0077`; focused
composition-client, row-identity and Definition contracts pass 79/79.

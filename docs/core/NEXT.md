# Sheetbase Core — Current Work

> **Implementation agents start here.**

## Programme

**Core Data Workspace**

## Active task

**CORE-03.15 — Reuse, sharing, duplication and lifecycle proof**

Task: [`tasks/CORE-03.md`](./tasks/CORE-03.md#core-0315--reuse-sharing-duplication-and-lifecycle-proof)

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
- CORE-03.7 — bound-column projection and provenance inspection
- CORE-03.8 — durable canonical Instance-local fields and typed values
- CORE-03.9 — authoritative calculation scopes over composed governed and
  Instance-local values
- CORE-03.10 — unambiguous composed Sheet write-back targets
- CORE-03.11 — bounded persisted Definition defaults and Instance presentation
  overrides
- CORE-03.12 — explicit value-free Instance structure extraction into a new
  Definition draft
- CORE-03.13 — explicit previewed Definition Version upgrade with controlled
  retain/map/defer reconciliation and durable provenance
- CORE-03.14 — explicit traceable composed-Sheet materialisation into an
  immutable Dataset Version
- product/architecture reset and accepted ADRs 0020–0026

## Required reading

1. [`tasks/CORE-03.md`](./tasks/CORE-03.md), CORE-03.15 only plus CORE-03.14 boundary
2. [`PRODUCT_CORE.md`](./PRODUCT_CORE.md), Dataset and Sheet sections
3. [`CORE_ARCHITECTURE.md`](./CORE_ARCHITECTURE.md), sections 4–9
4. ADR 0024 (shared typed parameters), with ADRs 0020–0023 and 0025 for the settled
   identity and compatibility boundaries

## Implement now

Prove the settled Sheet reuse, sharing, duplication and lifecycle invariants end
to end without adding new product behavior.

## Do not

- do not broaden presentation persistence into a general View subsystem;
- do not make presentation state semantic identity;
- do not implement full Pipeline semantics;
- do not alter the completed CORE-03.8–03.10 persistence contracts;
- do not silently coerce incompatible bindings or weaken exact version,
  lineage, quantity, vocabulary or stable semantic identity checks;
- do not redesign architecture already settled by ADRs 0020–0026;
- do not infer unsafe scientific unit equivalence or build the full
  unit-conversion/vocabulary-management product yet;
- do not weaken RLS/server validation;
- do not broaden paused specialist workspaces.

CORE-03.14 is complete. Migration `0089` adds explicit preview-confirmed
materialisation of bounded composed Sheet results through canonical Dataset
bulk commit and immutable snapshot contracts. Output manifests include governed
Definition columns, Instance-local fields and Instance calculations. Live
inputs become exact snapshots, pinned inputs retain their Dataset Versions, and
append-only provenance records source/Definition/Instance/calculation identity,
revision and actor/time. Retry is request-digest-bound; selected schemas require
exact compatibility; ordinary composition remains virtual. Focused DB proof
passes 7/7, including bound + local + calculated output and immutable reload;
focused TypeScript tests pass 2/2 with typecheck. CORE-03.15 owns invariant proof
only.

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

CORE-03.7 is complete. Migration `0078` keeps the bounded composition core
private and returns its pinned immutable Definition configuration plus
same-workspace active Record sources. The reusable bound-column projection
resolves only stable binding/field UUIDs, distinguishes Dataset-row and Record
provenance, exposes present-null versus unmatched states, and remains
read-only. Focused DB and projection/client suites pass 4/4 each. No placeholder
composed-Sheet route or write path was added; CORE-03.8 owns durable local data.

CORE-03.8 is complete. Generated migration `0079` plus custom migrations
`0079_core_038_prepare_generated_schema`/`0081` keep canonical local
FieldDefinitions and ordered typed values in bounded Instance state, while
adding a controlled atomic mutation RPC and actor/time/address audit ledger. Mutations require an
optimistic Instance revision and digest-bound retry token; exact retries return
the original committed revision and conflicting token reuse fails. Composed
addresses carry a bounded current composition offset plus canonical identity
values: the server derives the `sb-row-v1` key and proves that exact row in the
current controlled composition. Local-identity Instances may write only an
already-persisted UUID row, so legacy UUID syntax is not an identity bypass.
Generic Instance updates cannot bypass this mutation boundary.

Canonical scalar and ordered `many` validation shares the strict UUID,
calendar and RFC3339 semantics used by Sheet Definitions, including
null/default, constraints, active embedded category options and active
same-workspace compatible Record references. Stable add/edit/retire lifecycle,
history preservation, populated semantic immutability, duplicate-address
rejection, atomic failure, RLS/direct-write/helper ACLs and the single enabled
Instance guard have focused executable tests. All 82 migrations through `0081`
apply from fresh; affected Instance/composition/local DB suites pass 22/22 and
focused domain/data suites pass 29/29.

The submitted-revision envelope remains unchanged: Sheet Instances are not yet
embedded by the current submission architecture. The focused contract records
that limitation rather than inventing a snapshot owner; the future embedding
seam must include immutable Instance state/local-value evidence.

CORE-03.9 is complete. Generated migration `0082` and custom migration `0083`
add audited, optimistic and idempotent Instance-local calculation-definition
mutation plus trusted revision-bound result/error persistence and bounded
read. Immutable Definition Version calculations and durable Instance-local
calculations resolve stable Definition-column, local-field and calculation UUID
dependencies per semantic row; A1 is only a current dependency-slot projection.
Initial Instance creation cannot bypass the controlled calculation-definition
ledger, and cross-scope dependencies are checked against the pinned Definition.
The trusted Node worker reuses the existing parser, HyperFormula 3.3.0 and
scientific-core-v2 profile for bounded deterministic scalar arithmetic. Exact
quantity metadata is enforced without conversion. Result provenance includes
the pinned Definition Version, Instance revision, source Dataset-row revisions
and dependency addresses; stale values are hidden and calculated output is
read-only. Focused unit proof passes 8/8, and the focused DB contract passes
4/4 after a fresh migration. The submitted envelope remains unchanged and
still has no Sheet Instance embedding seam. CORE-03.10 owns write-back and must
preserve calculated read-only state.

CORE-03.10 is complete. Migration `0084` validates that every configured
write-back mapping names one exact bound column/source field and rejects
duplicate columns or authoritative targets. The authenticated composition RPC
now emits current Dataset revisions, Record metadata versions and stable
field-ID-to-storage-name maps, plus active Instance-local field IDs. The public
TypeScript orchestration accepts that parsed authoritative snapshot and stable
row/column IDs, resolves exactly one Dataset, Record or direct local-field
target, and only then dispatches through `commit_dataset_row_batch`,
`update_record_custom_fields` or `mutate_sheet_instance_local_state`.
Calculated, unmapped, unmatched, unresolved and ambiguous cells remain
non-writable; projected bound-column editability is derived only from exact
validated rules. Focused unit projection/wire/resolve/dispatch proof passes 9/9
with typecheck. The focused DB contract passes 6/6 after migration, covering
SQL-validator parity, authoritative provenance, exact Dataset retry payloads,
invalid/stale/conflict handling, controlled writes and ACLs. No Sheet editing
UI or CORE-03.11 implementation was added.

CORE-03.11 is complete. Migration `0085` extends mutable Instance presentation
state with up to 32 equality/empty filters and eight ordered sorts; immutable
Definition defaults support the same bounded query preferences alongside column
layout, freezing and density. Grouping is not stored because the current bounded
composition query has no grouped-result contract. A Definition-derived Instance
may omit presentation and receives those defaults, then owns its mutable
override through the existing revision-CAS update RPC.
Presentation IDs are checked against the pinned Definition columns plus local
and Instance-calculation columns; unsupported keys, invalid IDs and bounds are
rejected. Presentation changes preserve bindings, row identity, provenance and
local/calculation ownership. Focused TypeScript domain/data proof passes 24/24.
The focused Instance DB suite passes 13/13 after a fresh migration, covering
reload, defaults/overrides, stale revision, invalid IDs and helper ACLs. No
grouping execution, UI, View subsystem, materialisation or write-back ownership
changes were added.

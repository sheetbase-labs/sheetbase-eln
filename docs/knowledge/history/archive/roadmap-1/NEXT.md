# Sheetbase Core — Current Work

> **Implementation agents start here.**

## Programme

**Core Data Workspace**

## Active task

**Product Consolidation / Workflow Validation** (not started).

CORE-01–06 complete. Core Hardening H1–H5 complete. Legacy SCI-010 /
scientific-table / notebook-template record compatibility removed.

AUTO-01 remains deferred. Do not start Pipeline work from this hand-off.

Review: [`CORE_01_06_IMPLEMENTATION_REVIEW.md`](CORE_01_06_IMPLEMENTATION_REVIEW.md)

Hardening log: [`CORE_HARDENING.md`](CORE_HARDENING.md)

Canonical schema ADR: [`0038-canonical-dataset-schema-definitions.md`](../../../decisions/0038-canonical-dataset-schema-definitions.md)

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
- CORE-03.15 — end-to-end reuse, sharing, duplication and lifecycle proof
- CORE-03.16 — Purification Summary golden workflow and CORE-04 hand-off
- CORE-04.1 — Record selection/creation/import audit (accepted)
- CORE-04.2 — typed Record-reference cell contract
- CORE-04.3 — Model-scoped search, picker, and UUID write-back link
- CORE-04.5 — explicit Sheet row → Record mapping
- CORE-04.6 — validate-without-commit RPC
- CORE-04.4 — atomic inline create+link
- CORE-04.7 — all-or-nothing bulk Record commit
- CORE-04.8 — in-grid validation/error navigation
- CORE-04.9 — Definition Record actions hide/disable
- CORE-04.10 — Model-owned generated Record ID policy seam
- CORE-04.11 — Sample golden proof and composed-Sheet browser surface
- CORE-05.1 — capability/schema/dependency audit
- CORE-05.2 — capability vocabulary, `steward` role, role mapping
- CORE-05.4 — stable-ID dependency discovery
- CORE-05.10 — archive/restore and protected hard-delete
- CORE-05.5 — Model field evolution with impact preview
- CORE-05.6 — CORE-02 Dataset Schema version evolution
- CORE-05.7 — explicit local-field promotion
- CORE-05.8 — explicit calculation promotion
- CORE-05.9 — dense steward configuration workspace
- CORE-05.11 — Scientist/Steward/Admin proof and CORE-06 hand-off
- CORE-06.1 — Notebook / Template / revision / evidence audit
- CORE-06.2 — canonical Notebook Sheet blocks reference Sheet Instances
  (`0098_core_062_sheet_instance_blocks`); legacy `{tableId}` still renders
- CORE-06.3 / 06.4 / 06.11 — dedicated Notebook Template versions, CORE-03
  parameter mappings, section-placeholder boundary (`0099`)
- CORE-06.5 / 06.6 / 06.10 — instantiate independent Instances, explicit
  shared embeddings, Template retarget and Notebook upgrade (`0100`)
- CORE-06.7 / 06.8 / 06.9 / 06.12 / 06.13 — frozen Sheet evidence in the
  REV-002 envelope (`0101`), historical render, file checksums unchanged,
  Purification Summary golden proof
- CORE-06.14 — CORE-06 exit gate (`db:fresh --demo`, `test:db`, `validate`);
  AUTO-01 is not started and is not the next task

## Required reading

1. [`CORE_HARDENING.md`](CORE_HARDENING.md)
2. [`CORE_01_06_IMPLEMENTATION_REVIEW.md`](CORE_01_06_IMPLEMENTATION_REVIEW.md)
3. [`PRODUCT_CORE.md`](PRODUCT_CORE.md)
4. [`CORE_ARCHITECTURE.md`](CORE_ARCHITECTURE.md)
5. ADRs [`0020-sheet-definitions-instances-and-template-reuse.md`](../../../decisions/0020-sheet-definitions-instances-and-template-reuse.md), [`0022-reuse-semantics.md`](../../../decisions/0022-reuse-semantics.md) and [`0023-object-lifecycle-and-shared-instances.md`](../../../decisions/0023-object-lifecycle-and-shared-instances.md)

## Implement now

Core Hardening is complete. Next phase is Product Consolidation / Workflow
Validation. Do **not** start AUTO-01.

Core programme migrations: `0060`–`0110` (`0110` is a snapshot checkpoint
with no DDL). Latest generate baseline: `drizzle/meta/0110_snapshot.json`.

Core Hardening exit evidence: `pnpm db:fresh --demo` applied migrations
`0000`–`0109` and 27 idempotent demo seed steps (reseed also 27/27).
`pnpm test:db` 75 files / 721 tests. `pnpm validate` 179 files / 1,940 tests,
zero lint errors (21 existing warnings), production client/SSR build. The
CORE-02.6 100k+80k Dataset benchmark was not rerun.

CORE-06.14 exit evidence: `pnpm db:fresh --demo` applied migrations `0000`–
`0101` and 29 idempotent demo seed steps (reseed also 29/29). `pnpm test:db`
70 files / 707 tests. `pnpm validate` 176 files / 1,916 tests, zero lint
errors (21 existing warnings), production client/SSR build. The CORE-02.6
100k+80k Dataset benchmark was not rerun.

CORE-05.11 exit evidence: `pnpm db:fresh --demo` applied migrations `0000`–
`0096` and 29 idempotent demo seed steps (reseed also 29/29). `pnpm test:db`
65 files / 692 tests. `pnpm validate` 172 files / 1,905 tests, zero lint
errors (21 existing warnings), production client/SSR build. The CORE-02.6
100k+80k Dataset benchmark was not rerun.

CORE-04.11 exit evidence: `pnpm validate` 166 files / 1,893 tests, zero lint
errors, production client/SSR build; `pnpm test:db` 61 files / 679 tests.
The CORE-02.6 100k+80k Dataset benchmark was not rerun.

## Do not

- do not persist Record ID or Name as relationship identity;
- do not auto-create notebook `record_link` from Sheet cell link/create;
- do not invent a Sheet-specific Record ID generator or user-supplied IDs;
- do not add `create_model_record` / `update_record_custom_fields` to the
  external API allowlist;
- do not persist per-user capability grants or put capabilities in JWT claims;
- do not add governed schema/version behaviour to SCI-010;
- do not broaden presentation persistence into a general View subsystem;
- do not make presentation state semantic identity;
- do not implement full Pipeline semantics;
- do not start AUTO-01;
- do not alter the completed CORE-03.8–03.10 persistence contracts;
- do not silently coerce incompatible bindings or weaken exact version,
  lineage, quantity, vocabulary or stable semantic identity checks;
- do not redesign architecture already settled by ADRs 0020–0026;
- do not infer unsafe scientific unit equivalence or build the full
  unit-conversion/vocabulary-management product yet;
- do not weaken RLS/server validation;
- do not broaden paused specialist workspaces.

CORE-04 is complete. Binding product decisions were honoured: UUID write-back
only; notebook `create_record_link` stays separate; Model-generated
`PREFIX-YYYY-NNNN`; all-or-nothing bulk commit; atomic inline create+link;
minimal composed-Sheet grid at `/sheets/$instanceId`; Sample-only golden
workflow; Definition actions hide/disable in the UI while RLS remains the
server boundary (richer capabilities are CORE-05); no external API allowlist
expansion.

CORE-03 is complete. CORE-03.16's focused DB proof names the Purification
Summary Definition, its notebook-linked Instance, Sample/Upstream/Purification
sources, durable local Observation, calculated Recovery, persisted filter and
optional immutable materialisation with authenticated provenance. The current
composition contract remains a bounded 200-row virtual window. There is no
canonical composed-Sheet route, so this is server/API contract proof and not a
browser-grid acceptance claim. The representative CORE-02.6 100k+80k Dataset
benchmark remains feasibility evidence; no Sheet-composition benchmark was run.
Focused DB and TypeScript suites pass. Final `pnpm validate` passes with 155
test files / 1,869 tests, zero lint errors and the production client/SSR build.

CORE-03.15 is complete. Focused DB proof passes 4/4 for independent Instances,
shared Instance state, Dataset reuse without duplication, exact Definition
Version pinning and lifecycle behavior. Migration `0090` blocks new
instantiation from retired Definitions while preserving existing consumers, and
allows existing resolved Instances to read archived same-workspace Dataset
sources without weakening active-only new parameter resolution. CORE-03.16 owns
the golden workflow and CORE-04 hand-off only.

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

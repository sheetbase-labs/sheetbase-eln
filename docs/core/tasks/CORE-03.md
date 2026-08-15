# CORE-03 — Sheet Definition and Compositional Sheet Instance

**Status:** In progress — CORE-03.8 complete (2026-08-15)
**Blocked by:** CORE-02 epic exit gate (met).
**Normative decisions:** ADRs 0020–0026.

## Epic goal

Implement reusable versioned Sheet Definitions and working Sheet Instances over canonical Datasets and Models, preserving the existing Excel-like interaction and calculation guarantees.

## Epic invariants

- Definition and Instance are separate durable primitives.
- Definitions are reusable organisational configuration and do not inherit.
- Instances own local/ad hoc values.
- Dataset reuse is independent of Sheet state.
- Definition/Template dependencies remain pinned until explicit upgrade.
- Typed parameters and binding compatibility use stable semantic contracts.
- Row identity, joins and write-back are explicit.
- Calculations have explicit Instance/Definition/Dataset-derived scope.
- Presentation state is persisted without requiring a named View subsystem.
- Composition is virtual until explicitly materialised.
- Shared live Instances are explicit.
- Handsontable is an interaction projection, never authoritative storage.

---

## CORE-03.1 — Audit current Sheet and Template persistence

**Status:** Complete (2026-08-14).

**Goal:** Map the existing scientific Sheet, Notebook block, Handsontable, formula and Template implementation into Definition versus Instance responsibilities.

**Inspect:** current Sheet/table migrations and Drizzle schema; `src/components/sheet/`; scientific Sheet data modules; Notebook block persistence/rendering; Template code; HyperFormula workbook/dependency persistence; save coordination; Dataset Explorer interactions; focused DB/UI tests. Treat `api.query_dataset_rows` as a bounded complete active-field window with authoritative total/window state: it has no public field-projection, join, composition or aggregate API. Record `many` values are arrays ordered by persisted ordinal, not repeated scalar columns.

**Deliverables:** `docs/core/audits/SHEET_COMPOSITION_AUDIT.md` with exact files/tables/RPCs, current ownership of schema/data/presentation/formulas, keep/adapt/deprecate map, compatibility path for existing Sheets, and implementation ADR questions.

**Data/API changes:** None.

**Must preserve:** working spreadsheet interaction, formula identity/provenance, existing Notebook rendering and current scientific data.

**Do not:** migrate data, invent new storage, or redesign the Sheet UI.

**Evidence:** reproduce representative existing Sheet create/edit/formula/reload flows and record current contracts.

**Exit gate:** CORE-03.2/03.3 can be implemented without rediscovering where current Sheet truth lives.

## Completion evidence

- Added `docs/core/audits/SHEET_COMPOSITION_AUDIT.md`, mapping exact
  PostgreSQL, Notebook block, Handsontable, formula/workbook, Template and
  Dataset Explorer ownership into Definition versus Instance responsibilities.
- The audit records all retained legacy identities and version/provenance
  boundaries, the Template Sheet-reference seam, a data-preserving
  compatibility/termination path, and only the unresolved mappings CORE-03.2
  and CORE-03.3 must settle. It confirms that no new ADR is warranted before
  implementation exposes a durable physical-layout fork.
- Representative Sheet/data/workbook/Template/Explorer unit and component
  contracts pass in the full configured Vitest run: 142 files and 1,718 tests.
  Focused scientific-table, Sheet-block, formula-persistence and Template DB
  contracts pass: 4 files and 32 tests. `pnpm check` and broader
  documentation-only validation results are recorded in the audit.

---

## CORE-03.2 — Implement Sheet Definition identity and immutable versions

**Status:** Complete (2026-08-14).

**Blocked by:** CORE-03.1.

**Goal:** Add durable reusable Sheet Definition/version persistence.

**Deliverables:** additive migrations; organisation/tenant-scoped Definition identity; immutable published versions; lifecycle state; typed parameters; binding specs; row-identity spec; joins; column definitions; calculation definitions; write-back rules; actions; presentation defaults; RLS/API/domain types; draft/publish/read/retire operations.

**Must preserve:** existing scientific Sheets through a compatibility/migration path; stable semantic field IDs.

**Do not:** store Instance-local values in Definitions; add Definition inheritance; silently update dependants when publishing.

**Tests/evidence:** DB/RLS/API tests for draft/publish/version pinning/retirement and cross-workspace isolation; fresh migrate/seed if changed.

**ADR trigger:** only if physical Definition/version persistence presents a durable fork not settled by ADR 0020/0022.

**Exit gate:** a versioned Definition can exist independently of a Notebook/Instance and published versions are immutable dependency targets.

## Completion evidence

- Migrations `0071_thankful_warlock.sql` and
  `0072_core_032_sheet_definitions.sql` add workspace-owned Definition
  identities and explicit monotonic Definition Versions. Each version owns one
  format-versioned configuration document; stable machine keys, version
  identity and publication content are protected by database triggers.
- The controlled API provides owner/admin create, metadata update, new-version,
  draft update, publish and retirement RPCs. RLS permits workspace-member reads,
  denies cross-workspace reads and grants no ordinary authenticated table
  mutation. Published and retired targets remain readable; retiring a
  Definition blocks further draft configuration, publication and version
  creation.
- `src/lib/sheet-definition.ts` defines and parses the bounded configuration
  contract for typed parameters, bindings, row identity, joins, canonical
  `FieldDefinition` columns, calculations, write-back rules, actions and
  presentation defaults. Both TypeScript and PostgreSQL validate stable UUID
  uniqueness and required internal references. `sheet-definition-data.ts`
  exposes only RLS table reads and controlled RPC writes.
- Focused proof passes: Sheet Definition domain/data tests 61/61, DB/RLS tests
  10/10 and live PostgREST API tests 2/2. The shared TypeScript/public-DB
  parity matrix covers the non-nil RFC UUID dialect, strict calendar-aware
  RFC3339 timestamps and one-to-one calculation outputs. Compatibility DB
  proof for scientific tables, Sheet blocks, formulas, Templates and submitted
  envelopes passes 5 files / 40 tests. The full DB gate passes 52 files / 624
  tests.
- All 73 migrations (`0000`–`0072`) apply on a fresh database; the demo seed
  and a second idempotent demo seed pass. `pnpm validate` passes 143 files /
  1,779 tests and the production build with
  zero lint errors (the existing warnings remain).
- Existing scientific Sheet, Notebook, Template, formula and frozen-evidence
  persistence was not changed or adopted. No Sheet Instance, composition,
  execution or legacy migration was added. The implemented normalized
  identity/version layout is the controller-selected ADR 0020/0022 design, so
  no new ADR was required.

---

## CORE-03.3 — Implement Sheet Instance identity and resolved bindings

**Status:** Complete (2026-08-14).

**Blocked by:** CORE-03.2.

**Goal:** Add the durable working Sheet object.

**Deliverables:** Instance persistence; optional source Definition/version; project/notebook context; resolved bindings; local-field container; calculation/override state; presentation state; lifecycle/provenance; create ad hoc/create from Definition/read/archive/duplicate operations.

**Must preserve:** Definition reuse never shares local working state; duplicating an Instance does not duplicate bound Datasets/Records.

**Do not:** make Notebook block identity equal Sheet Instance identity.

**Tests:** independent Instances from one Definition; duplicate semantics; archive/read; RLS; reload.

**Exit gate:** two Instances from one Definition are independently durable while retaining source Definition/version provenance.

## Completion evidence

- Migrations `0073`/`0074` add workspace-owned Sheet Instance identity with an
  immutable optional published Definition Version pin, independent bounded
  working state, optimistic revision, archive lifecycle and controlled
  ad-hoc/from-Definition/update/archive/duplicate operations.
- TypeScript and PostgreSQL share the accepted UUID dialect and canonical
  `FieldDefinition` boundary. Resolved Dataset/Record references, Dataset
  Version ownership, workspace context, source publication and pinned
  Definition binding/parameter identity are enforced before persistence.
- Focused domain/data tests pass 18/18 and DB/RLS lifecycle tests pass 10/10.
  Direct table mutation is denied, the guard is enabled, helper execution is
  revoked, member reads are workspace-scoped, and migrator writes still require
  the narrow transaction-local RPC guard value.
- Duplication creates a new Instance identity and deep-copied JSON working
  state while preserving concrete reference IDs; subsequent mutation remains
  isolated. Archive remains readable and blocks updates, repeat archive and
  duplication. Existing scientific Sheet/Notebook/Template/formula/submitted
  evidence persistence remains unchanged.
- Fresh migration plus demo seed, focused legacy compatibility, formatting,
  typecheck, changed-file lint and `git diff --check` pass. CORE-03.4 remains
  responsible for semantic binding compatibility and row-identity execution.

---

## CORE-03.4 — Implement shared typed parameters and binding compatibility

**Status:** Complete (2026-08-15).

**Blocked by:** CORE-03.2, CORE-02 schema/version contracts.

**Goal:** Resolve Definition inputs to permitted concrete sources using the common Parameter concept.

**Deliverables:** parameter domain contract reusable by future Templates/Pipelines; scalar and typed object-reference parameters required by Core; exact schema-version, compatible-lineage and semantic/structural Dataset compatibility; binding-resolution errors; resolution provenance.

**Must preserve:** stable semantic identity and quantity/vocabulary compatibility from CORE-01/ADR 0025.

**Do not:** match solely by labels; silently coerce incompatible quantity kinds; invent separate Sheet-only parameter semantics.

**Tests:** exact/compatible/incompatible Dataset bindings; missing required parameter; Record<Model> parameter; quantity mismatch.

**Exit gate:** one Definition can safely instantiate against multiple compatible Datasets without hard-coded Dataset IDs.

## Completion evidence

- `src/lib/parameter.ts` owns the reusable scalar, `Record<Model>`, Dataset and
  Dataset Version Parameter contract. Sheet Definition validation consumes it,
  and TypeScript/PostgreSQL parity includes exact, compatible-lineage and
  semantic contracts plus typed defaults and scalar constraints.
- Migration `0075_core_034_parameter_resolution.sql` adds a controlled
  Definition-instantiation RPC. It resolves supplied values server-side,
  validates stable Record Model identity and Dataset ownership/lifecycle, pins
  live or immutable source Schema Versions, and persists canonical bindings,
  scalar values and immutable resolution provenance. Legacy client-authored
  Definition bindings and direct/helper access remain denied; ad hoc create and
  update strip reserved resolution and Record-model metadata.
- Exact compatibility requires the same Schema Version. Lineage compatibility
  requires one Schema identity and preservation of every baseline active field.
  Semantic compatibility permits other Schema identities but requires stable
  field UUIDs and compatible logical type, cardinality, quantity, embedded
  option/vocabulary identity and relationship semantics. Labels are ignored.
  Compatibility is conservative: no unit conversion or vocabulary alias engine
  is inferred.
- Focused executable proof covers two Datasets resolved by one Definition,
  exact/version failures, lineage and cross-Schema semantic success/failure,
  quantity/category/reference mismatches, Dataset Version provenance, scalar
  defaults/constraints, unknown/duplicate/missing inputs, `Record<Model>`,
  cross-workspace/inactive Datasets, forged provenance, duplicate/reload
  durability, the live Definition-instantiation API and helper/direct-write
  ACLs. CORE-03.5 row-identity execution is not included.
- Final verification passes: shared domain/data 90/90, focused Definition,
  Instance and resolution DB/RLS 31/31, live API 3/3, and focused legacy
  Sheet/Template/formula/frozen-evidence compatibility 40/40. All 76 migrations
  (`0000`–`0075`) apply on a fresh database and the 29-step demo seed passes;
  formatting, typecheck, changed source-file lint and `git diff --check` pass.
- Current canonical Dataset Schema publication supports embedded category
  options only. The compatibility helper already compares governed vocabulary
  UUID identity and rejects mismatches, but no vocabulary-management or unit
  conversion engine is introduced by this task. Dataset fields also remain
  stored-field contracts, so there is no separate persisted Dataset computation
  semantic to compare yet.
- Parameter patterns are syntax-checked by both JavaScript and PostgreSQL.
  Their regular-expression dialects are not identical, so configurations must
  use the common portable subset; no regex translation engine is introduced.

---

## CORE-03.5 — Implement row identity

**Blocked by:** CORE-03.3/03.4.

**Goal:** Make composed row identity explicit and stable.

**Deliverables:** source, composite and local identity specs; deterministic row-key generation; uniqueness validation; stable identity across sorting/filtering/reload; error state for non-unique/missing identities.

**Do not:** use visual row number/index as durable identity.

**Tests:** Sample ID; `[Sample, Timepoint]`; local UUID; reorder/filter stability; duplicate-key failure.

**Completion evidence (CORE-03.5):** `sb-row-v1` is a SHA-256 key over ordered
stable column UUIDs and type-tagged scalar values; missing, unsupported and
duplicate values return structured batch errors before any caller mutation.
Pinned Instances persist only their authoritative resolved identity spec and
source binding/field provenance via a revision-checked RPC. Local identities
use a persisted non-nil UUID address. No join, projection, local-value mutation
or write-back executor is included.

**Exit gate:** local values, joins and write-back can target rows without relying on grid position.

---

## CORE-03.6 — Implement constrained multi-source joins

**Blocked by:** CORE-03.4/03.5.

**Goal:** Compose multiple Dataset/Model bindings predictably.

**Deliverables:** explicit equality joins over stable reference/Record identities (never labels or row position); supported join types documented; cardinality expectation; server/query execution strategy beyond the existing single-Dataset query RPC; clear missing/unmatched states; detection of unexpected many-to-many expansion.

**Must preserve:** source row identities and provenance.

**Do not:** expose arbitrary client SQL; silently multiply rows.

**Tests:** one-to-one, many-to-one, unmatched, expected one-to-many if supported, rejected unexpected many-to-many.

**Exit gate:** Sample + two result Datasets can compose by stable Sample identity with explainable cardinality.

## Completion evidence

- Migration `0077_core_036_sheet_composition.sql` adds the bounded,
  authenticated `api.query_sheet_instance_rows` RPC. It composes only active,
  Definition-pinned, server-resolved Dataset bindings and accepts a maximum
  200-row window with an offset capped at 10,000.
- Equality keys must be scalar `reference` fields with identical stable
  relationship contracts. The executor preserves the left Dataset row and
  every joined source row, revision, Dataset binding and complete active-field
  value map. It returns an explicit unmatched source state for left joins and
  rejects missing/stale resolution, non-Dataset sources, unsupported join
  topology and duplicate right identities with structured PostgreSQL errors.
- The execution boundary is intentionally virtual and source-oriented:
  bound-column rendering, local fields, calculations, write-back and
  materialisation remain out of scope for CORE-03.7 and later.
- Initial execution deliberately supports a bounded star topology: every
  declared join shares one left Dataset binding, so Sample plus multiple result
  Datasets remains explainable without recursive intermediate multiplication.
  Definitions that require chained joins fail explicitly rather than receiving
  a silently different plan.
- `tests/db/sheet-composition.test.ts` is the compact executable DB contract
  for the Sample-plus-two-results exit gate, cardinality and unmatched states,
  deterministic root paging/provenance, lifecycle/topology/bounds failures and
  RPC/helper ACLs. The focused suite passes 3/3 after migration `0077`; the
  composition client, row-identity and Definition suites pass 79/79.

---

## CORE-03.7 — Implement bound columns and provenance inspection

**Blocked by:** CORE-03.6.

**Goal:** Project Dataset, Model and relationship fields into the composed grid while retaining semantic/source identity.

**Deliverables:** bound-column resolution; canonical editors/renderers; source field/Definition/binding metadata; inspectable provenance; permission/read-only state; stable column IDs independent of position/label.

**UX:** keep provenance discoverable through headers/inspector without cluttering every cell.

**Tests:** Dataset field, Model field, relationship, permission/read-only, rename/reorder stability.

**Exit gate:** a user can identify where a displayed governed value came from and its authoritative target.

## Completion evidence

- Migration `0078` retains the bounded CORE-03.6 composition function as a
  private implementation and returns the pinned immutable Definition
  configuration with the authenticated composition response. It does not alter
  join cardinality, row/source provenance, bounds, RLS or create a write path.
- `sheet-bound-columns.ts` projects only `bound` Definition columns by stable
  binding and source-field UUID. Each result exposes its canonical
  `FieldDefinition`, editor presentation, stable ID/key/label, explicit
  Definition/binding/Dataset/row/revision/field provenance and an honest
  authenticated-membership read-only capability state. An unmatched join is a
  distinct value state from a present `null`.
- Resolved `Record<Model>` bindings are revalidated as active same-workspace
  Records for every bounded query and contribute a constant `record` source
  using active canonical `record_field_definitions`/`custom_fields`; they do
  not participate in or expand Dataset joins. Dataset and Record provenance are
  discriminated, so a Dataset row UUID is never represented as a Record ID.
- There is no canonical composed-Sheet route yet, so the reusable projection
  and inspector schema are the UI boundary. Existing scientific Sheet and
  Dataset Explorer surfaces remain unchanged; no placeholder grid, local
  fields, calculations or write-back was introduced.
- Focused projection tests cover Dataset, Model and relationship values,
  null-versus-unmatched, read-only state, rename/reorder row-key stability and
  malformed binding/source maps. The existing composition client contract
  remains compatible. Migration `0078` applies successfully; focused DB
  composition/Record projection passes 4/4 and projection/client tests pass
  4/4.

---

## CORE-03.8 — Implement durable local/ad hoc fields and values

**Blocked by:** CORE-03.3/03.5.

**Goal:** Make exploratory columns first-class durable Instance-owned data.

**Deliverables:** canonical local FieldDefinition semantics; stable local field IDs; values keyed by composed row identity; add/edit/retire local field; bulk paste; audit/provenance; frozen-snapshot compatibility.

**Must preserve:** ad hoc means locally governed, not ephemeral.

**Do not:** store values only in Handsontable/React; automatically alter Dataset Schema.

**Tests:** reload, sharing same Instance, independent Instances, row reorder, typed validation, retired local field history.

**Exit gate:** local Observation-style data survives reload/share and remains correctly attached to semantic rows.

**Implementation evidence:** Generated migration `0079` and custom migrations
`0079_core_038_prepare_generated_schema`/`0081` add the ledger and bounded
controlled local mutation RPC, canonical typed/default/category/reference enforcement,
digest-bound exact retry results and actor/time/affected-address audit ledger.
The server derives every composed `sb-row-v1` address from supplied canonical
identity values and proves it at a bounded offset in the current controlled
composition; local identity writes require an already-persisted UUID row.
Stable field add/edit/retire, populated semantic immutability, ordered `many`,
atomic duplicate/malformed rejection, reload/reorder/share and Instance
isolation, RLS/direct-write/helper ACLs and the sole enabled Instance guard have
focused executable domain/data and DB tests. The submitted-revision envelope is
intentionally unchanged because current submission storage has no Sheet
Instance embedding seam; a future embedding owner must freeze Instance state
and local values rather than this task inventing submission architecture.
All 82 migrations through `0081` apply from fresh; affected
Instance/composition/local DB suites pass 22/22 and focused domain/data suites
pass 29/29.

---

## CORE-03.9 — Implement calculation scopes on composed Sheets

**Blocked by:** CORE-03.5–03.8.

**Goal:** Preserve existing formula UX/trust while calculations resolve across composed sources.

**Deliverables:** Instance-local and Definition calculation definitions; stable semantic dependency mapping beneath A1 UI; output quantity semantics where declared; stored errors without formula destruction; recalculation/reload behaviour; provenance.

**Must preserve:** deterministic function profile, existing HyperFormula interaction, formula definitions as authority rather than cached values.

**Do not:** persist A1 coordinates as semantic dependencies; infer unsafe scientific unit equivalence; implement full Pipeline semantics.

**Tests:** cross-source Recovery calculation, rename/reorder stability, error persistence, quantity metadata, reload/recalc.

**Exit gate:** calculations work across the golden composed Sheet without losing stable dependency/provenance semantics.

**Implementation evidence:** Generated migration `0082` and custom migration
`0083` add durable revision-bound calculation results and an audited,
idempotent controlled Instance-calculation mutation contract. Definition
calculations remain pinned in immutable Definition Versions; Instance-local
definitions use stable calculation/local-field/Definition-column UUID
dependencies, while A1 survives only as a dependency-slot UI expression. The
trusted Node worker reuses the existing formula parser, HyperFormula 3.3.0 and
`scientific-core-v2` runtime under a deliberately bounded scalar-arithmetic
profile. It resolves each semantic `sb-row-v1` from the governed 03.7
projection plus 03.8 local values, records exact Dataset-row revisions and
dependency provenance, and persists structured missing, unmatched, type,
quantity, divide-by-zero and evaluation errors without replacing definitions.
Exact quantity metadata is required and no unit conversion or equivalence is
inferred. Read results are explicitly read-only and hide stale values after an
Instance or recorded Dataset-row revision changes. Focused unit proof covers
cross-source Recovery, stable identity across label/order changes, strict
quantity handling and error-to-success recalculation (8/8). Focused DB proof
for CAS/idempotency, cache/provenance, stale/read-only results, bounds,
RLS/direct/helper ACLs, governed composition, cross-scope dependencies,
creation-bypass rejection and the frozen-evidence boundary passes 4/4 in
`tests/db/sheet-calculations.test.ts` after a fresh migration. The existing
submitted envelope remains unchanged: current revision storage still has no
Sheet Instance embedding seam.

---

## CORE-03.10 — Implement unambiguous write-back

**Blocked by:** CORE-03.7–03.9.

**Goal:** Route every editable cell to exactly one authoritative source.

**Deliverables:** resolved write-back targets for Dataset, Model and local fields; Dataset writes routed through the controlled bounded bulk contract with expected Dataset/row revisions and actor-scoped idempotency; server validation/errors mapped back to cells; optimistic/save-state behaviour; calculated fields read-only; permission enforcement.

**Do not:** infer write target from displayed label/position; allow ambiguous configuration.

**Tests:** edits to each target kind; denied write; invalid value; stale/conflict handling; calculated-field rejection.

**Exit gate:** editing a composed Sheet never leaves source ownership ambiguous.

**Implementation evidence:** Migration `0084` requires each configured
write-back mapping to name one exact bound column/source field and rejects
duplicate columns or authoritative targets. Authenticated composition carries
the current Dataset revision, Record metadata version and stable
field-ID-to-storage-name map, plus active Instance-local field IDs. The public
TypeScript boundary resolves stable row/column IDs from that parsed snapshot
before dispatching through the existing controlled Dataset, Record or local
RPC; Dataset writes retain Dataset/row CAS and actor-scoped exact retries.
Calculated, unmapped, unmatched, unresolved and ambiguous cells remain
non-writable, and projected editability comes only from an exact validated
rule. Focused projection/wire/resolve/dispatch tests pass 9/9. The focused DB
contract passes 6/6 after migration, covering validator parity, authoritative
provenance, controlled target writes, retries, stale/invalid/conflict outcomes
and ACLs. This is the data/domain write-back boundary; no broad Sheet editing
UI was added.

---

## CORE-03.11 — Persist presentation state

**Blocked by:** CORE-03.3.

**Goal:** Preserve useful Sheet layout/query state without creating a premature View subsystem.

**Deliverables:** filters, sorts, grouping where supported, column order/visibility/width, freezing/density/defaults; clear ownership between Definition defaults and Instance mutable state.

**Do not:** make presentation state semantic identity or a prerequisite for data reconstruction.

**Tests:** reload and Definition-default/Instance-override behaviour.

**Exit gate:** a scientist returns to a useful working layout without underlying data/schema semantics changing.

## Completion evidence

- Migration `0085_core_0311_sheet_presentation.sql` adds bounded equality/empty
  filters and ordered sorts to mutable Instance presentation state and immutable
  Definition defaults, alongside column order/visibility/width, freezing and
  density. Grouping is deliberately unsupported: no grouped-result
  contract exists on the bounded composition RPC.
- Definition Versions retain immutable presentation defaults. Creating a
  Definition-derived Instance without presentation copies those defaults into
  the mutable Instance state; a supplied or later revision-CAS update is an
  Instance-only override. Presentation validation is bounded and checks stable
  IDs against Definition, local and Instance-calculation columns.
- Focused TypeScript domain/data tests pass 24/24. The focused Instance DB suite
  passes 13/13 after a fresh migration, covering reload, defaults/overrides,
  invalid IDs, stale revisions and helper ACLs while preserving bindings,
  provenance and row identity.

---

## CORE-03.12 — Implement Save Instance as Definition

**Blocked by:** CORE-03.3–03.11.

**Goal:** Turn useful ad hoc work into reusable configuration.

**Deliverables:** extraction/preview operation; concrete Dataset bindings parameterised where appropriate; selected local field definitions retained without values; selected calculations retained; optional presentation defaults; permission checks; new Definition draft/version.

**UX:** show exactly what becomes reusable and what data is excluded.

**Do not:** copy experiment/local values into Definition.

**Tests:** ad hoc → Definition → new independent Instance; source parameterisation; no value leakage.

**Exit gate:** useful exploratory Sheet structure can become reusable safely.

---

## CORE-03.13 — Implement explicit Definition upgrade semantics

**Blocked by:** CORE-03.2/03.3.

**Goal:** Upgrade an existing Instance to a newer Definition version without silently losing Instance-owned state.

**Deliverables:** impact/diff model; three-way comparison of source Definition, Instance changes and target Definition; automatic compatible changes; conflict states; retain-local/map/defer outcomes; provenance of upgrade.

**Do not:** auto-follow latest; discard local values/formulas silently.

**Tests:** added column; renamed label; removed populated local column conflict; changed binding requirement; failed/deferred upgrade.

**Exit gate:** Definition evolution is safe for existing scientific work.

---

## CORE-03.14 — Implement explicit materialisation

**Blocked by:** CORE-03.6–03.10, CORE-02 Dataset creation/versioning.

**Goal:** Create a durable Dataset from a composed Sheet result only when explicitly requested.

**Deliverables:** materialisation preview; output Dataset Schema derivation/selection; immutable source-version pinning for reproducibility; output Dataset creation through controlled bulk/revision/idempotency contracts; provenance linking source versions, Sheet Definition/Instance, calculations and actor/time; safe retry/idempotency. The CORE-02 100k+80k storage join/projection/aggregate benchmark is feasibility evidence only and does not provide Sheet composition or materialisation APIs.

**Do not:** automatically materialise ordinary composition; treat materialisation as a hidden client export.

**Tests:** golden composition → output Dataset; reproducibility; retry; provenance.

**Exit gate:** a composed result can become a traceable Dataset using semantics compatible with future Pipeline Runs.

---

## CORE-03.15 — Reuse, sharing, duplication and lifecycle proof

**Blocked by:** CORE-03.2–03.14.

**Goal:** Prove ADR 0020–0024 invariants end to end.

**Evidence:** multiple Instances from one Definition; same Dataset reused in independent Instances; deliberate shared Instance reflects same local data; duplicate Sheet does not duplicate Dataset; retired Definition blocks new instantiation but existing Instance works; archived source remains resolvable to existing consumers; no silent upgrades.

**Exit gate:** reuse/lifecycle behaviour is predictable and tested.

---

## CORE-03.16 — Golden workflow and CORE-04 hand-off

**Blocked by:** CORE-03.15.

**Goal:** Prove the full compositional Sheet slice and promote CORE-04 based on implementation evidence.

**Workflow:** `Purification Summary` Definition → Notebook Sheet Instance → Sample Records + Upstream Results + Purification Results + local Observation + calculated Recovery; paste/edit/reload/filter; inspect provenance; optional materialisation.

**Evidence:** DB/API/UI tests, fresh migration/seed where relevant, representative performance, `pnpm validate`.

**Hand-off:** record completion evidence and update `NEXT.md` to CORE-04.1.

## Epic exit gate

A reusable versioned Sheet Definition creates independent compositional Sheet Instances; multi-source identity/joins/write-back/local/calculated state are correct; reuse/upgrades/lifecycle are safe; and composition remains virtual unless explicitly materialised.

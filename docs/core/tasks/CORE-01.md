# CORE-01 — Common Schema Kernel

**Status:** Active / implementation-ready  
**Epic goal:** Models and Datasets use one coherent semantic field language without discarding the working extensible Model foundation.

## Epic invariants

- The existing PostgreSQL-authoritative Model framework is a foundation to converge, not something to replace casually.
- A common semantic contract does not require one physical EAV storage mechanism.
- Stable field IDs back dependencies; labels and visual positions do not.
- Server-side validation remains authoritative.
- Historical values remain interpretable when fields evolve/retire.
- Dataset-specific semantics may extend the common kernel without creating an incompatible second type system.
- Do not implement Dataset physical storage in this epic except for minimal contract/test fixtures required to prove shared semantics.

---

# CORE-01.1 — Audit current field and schema contracts

**Status:** NEXT  
**Blocked by:** Nothing.

## Goal

Establish exactly which field/schema concepts already exist in the current repository and map them to the proposed common Field Definition kernel before any convergence migration is designed.

## Why

The repository already contains an extensible Model framework, scientific Sheet/table schemas, formula identifiers, validation logic and UI field controls. Implementing a new kernel without auditing these would risk creating a third schema system or breaking durable dependencies.

## Existing implementation to inspect

At minimum locate and inspect:

- migration `0057_model_fields_foundation` and subsequent migrations touching Model fields;
- Drizzle schema definitions for model registry/fields and scientific table/schema data;
- PostgreSQL validation functions/triggers/RPCs for custom properties and scientific rows;
- TypeScript Model/field contracts and typed field controls;
- scientific Sheet column/schema configuration types;
- unit/validation/category/relationship representations;
- formula definition/dependency storage and how formula columns bind to stable identities;
- PostgREST-exposed views/tables/RPCs involving these concepts;
- Samples/Reports custom-property consumers introduced by PR #27;
- relevant tests and ADRs.

Use repository/code search to discover exact current paths. Record them in the audit rather than relying on this task file to stay path-perfect forever.

## Deliverables

Create `docs/core/audits/FIELD_SCHEMA_AUDIT.md` containing:

1. inventory of existing field/schema representations;
2. exact source/migration/table/type/RPC references;
3. current value-type vocabularies;
4. current validation representations;
5. unit semantics;
6. relationship/reference semantics;
7. stable identity/dependency semantics;
8. lifecycle/version behaviour;
9. permissions/RLS behaviour;
10. UI rendering/editing contracts;
11. mapping of each current concept to proposed `FieldDefinition` semantics;
12. duplicates/incompatibilities/gaps;
13. proposed convergence path ranked as preserve/adapt/deprecate;
14. specific ADR questions that CORE-01.2/01.3 must settle.

## Data/API changes

**None.** This is an audit task.

## Must preserve

No production behaviour should change.

## Do not

- create migrations;
- rename tables/types/RPCs;
- introduce new production field types;
- refactor UI controls;
- change formula bindings;
- decide Dataset physical storage;
- infer behaviour only from docs when code/database definitions exist.

## Tests / evidence

No new runtime tests required. Evidence is the completeness and specificity of `FIELD_SCHEMA_AUDIT.md`. Run documentation formatting/checks applicable to changed files.

## ADR trigger

None during the audit. Record ADR **questions**, do not settle implementation choices prematurely.

## Exit gate

A new engineer can read the audit and answer:

- what field/schema systems exist now;
- which concepts are already good enough to preserve;
- exactly where the type/validation/identity mismatches are;
- what decisions must be made before a convergence migration.

## Completion evidence

_To be completed by implementing agent._

---

# CORE-01.2 — Define the canonical Field Definition contract

**Status:** Planned / implementation-ready after CORE-01.1  
**Blocked by:** CORE-01.1.

## Goal

Define the canonical semantic Field Definition contract in TypeScript/documentation, explicitly mapping every property to current implementation or planned convergence behaviour.

## Why

Models, Dataset Schemas, Sheets, filters, formulas and Pipelines need a shared language for what a field means before storage/UI work can safely converge.

## Existing implementation to inspect

Use `FIELD_SCHEMA_AUDIT.md` as the required inventory. Re-read existing model-field types, scientific column types and relevant ADRs identified there.

## Deliverables

- canonical domain contract/type for `FieldDefinition` in the appropriate shared domain layer;
- documented initial value-type vocabulary;
- explicit semantics for nullability/requiredness, cardinality, defaults, validation, units, controlled vocabulary, Record relationships, computed state and lifecycle;
- compatibility mapping from existing Model field types;
- rules for stable `field_id`, key and label changes;
- serialization/API representation proposal;
- tests for pure contract validation/normalisation where code is introduced;
- update `CORE_ARCHITECTURE.md` only if implementation evidence requires clarification rather than semantic change.

## Data/API changes

Prefer **none** in this task. Define the contract before migrating storage. If a minimal additive type/table change is truly required to prove the contract, document why and split it into CORE-01.3 instead.

## Must preserve

- current Model field IDs and existing values;
- existing scientific formula dependency identities;
- current public API behaviour;
- current server-side validation.

## Do not

- create a generic `any`/JSON schema that loses typed semantics;
- make UI display metadata part of semantic field identity;
- introduce dozens of scientific primitive types when metadata over a small type system is sufficient;
- force Models and Datasets into identical physical storage;
- migrate production data in the same change merely because the type contract exists.

## Tests / evidence

- unit tests for contract validation/normalisation;
- compile-time exhaustiveness where practical;
- examples covering text, decimal + unit, categorical and Record reference fields;
- evidence that existing Model field concepts can map without loss.

## ADR trigger

Create/propose an ADR if the audit shows the canonical contract requires changing stable field identity semantics or cannot be represented compatibly with existing Model fields.

## Exit gate

There is one reviewed semantic field vocabulary that both Model and future Dataset Schema code can consume, with no production data migration yet required.

## Completion evidence

_To be completed by implementing agent._

---

# CORE-01.3 — Converge existing Model fields onto the kernel

**Status:** Planned  
**Blocked by:** CORE-01.2.

## Goal

Adapt the existing extensible Model framework so its definitions are the first production consumer of the canonical Field Definition semantics without breaking existing Records or API behaviour.

## Why

The Model framework is the strongest existing configurable-schema implementation and should prove the kernel before Dataset work consumes it.

## Existing implementation to inspect

- audit and CORE-01.2 contract;
- model registry/base-field/workspace-field migrations;
- management RPCs;
- custom-property validation;
- Samples/Reports custom-property editing/search;
- model-field admin UI and tests.

## Deliverables

- additive migration(s) only where required;
- compatibility/adaptation layer from existing model fields to canonical semantics;
- server validation updated to canonical semantics where safe;
- existing base fields remain protected;
- existing custom values preserved;
- lifecycle semantics aligned with the kernel;
- API representations remain stable or are versioned/migrated explicitly;
- focused DB/API/application tests.

## Data/API changes

Expected additive DB changes may be required. Direct PostgREST writes must remain subject to PostgreSQL validation.

## UX behaviour

Existing Model configuration and Record editing should continue working. Do not redesign the Model Fields screen in this task beyond changes required to represent canonical semantics honestly.

## Must preserve

- field IDs;
- retired/legacy values;
- unknown legacy properties behaviour already deliberately supported;
- RLS/workspace isolation;
- protected base-field guarantees;
- idempotent demo seed.

## Do not

- drop/recreate `model_fields` to achieve a cleaner schema;
- rewrite applied migrations;
- silently reinterpret existing field values;
- expose schema-edit permissions to ordinary users as a shortcut;
- expand Samples/Reagents features unrelated to convergence.

## Tests / evidence

- fresh DB migrate + seed;
- existing focused model DB tests;
- API validation tests for valid/invalid custom properties;
- RLS isolation tests;
- existing Sample/Report custom-property UI tests;
- `pnpm validate`.

## ADR trigger

Required if physical storage/identity semantics materially change from the current Model framework.

## Exit gate

Existing Models/Records use the canonical semantic kernel without user-visible regression or loss of historical data, and the database remains authoritative.

## Completion evidence

_To be completed by implementing agent._

---

# CORE-01.4 — Define Dataset Schema field semantics against the kernel

**Status:** Planned  
**Blocked by:** CORE-01.2; preferably CORE-01.3.

## Goal

Define how Dataset Schema fields consume the common kernel and which additional Dataset-specific metadata is required.

## Why

CORE-02 must not invent a second field vocabulary while designing Dataset storage.

## Deliverables

- `DatasetFieldDefinition` or equivalent contract that composes/extends canonical field semantics;
- explicit distinction between semantic field definition and Dataset-specific binding/shape metadata;
- rules for stable Dataset field IDs;
- row-identity eligibility rules;
- formula/calculated-field relationship clarified;
- mapping from current scientific Sheet/table column definitions;
- migration notes for CORE-02.

## Data/API changes

None preferred. This task defines the Dataset-facing contract.

## Must preserve

Current formula and scientific column semantics identified in the audit.

## Do not

- choose Dataset physical storage merely to make the TypeScript type easy;
- treat column order/width/label as semantic identity;
- encode Sheet-specific display state in Dataset Schema.

## Tests / evidence

Contract/unit tests and representative schema examples.

## ADR trigger

If existing scientific formula/column identity cannot map to stable Dataset field identity without a breaking migration, create the ADR before CORE-02 implementation.

## Exit gate

CORE-02 can design Dataset persistence without making new decisions about basic field meaning.

## Completion evidence

_To be completed by implementing agent._

---

# CORE-01.5 — Unify field rendering and editing contracts

**Status:** Planned  
**Blocked by:** CORE-01.3, CORE-01.4.

## Goal

Ensure UI field controls consume canonical semantics rather than separate Model-versus-Dataset type vocabularies.

## Deliverables

- shared field renderer/editor selection contract;
- existing Model property controls adapted to it;
- Dataset/Sheet consumers can reuse the same semantic type handling later;
- units, categorical values and Record references represented consistently;
- read-only/permission/validation states explicit.

## Data/API changes

None expected.

## UX behaviour

Do not force every field into the same visual control. Share semantics and control-selection logic while allowing Sheet cells, forms and inspectors to render appropriately for context.

## Must preserve

Dense UI direction, keyboard/accessibility behaviour and existing Record editing.

## Do not

- build Dataset UI before CORE-02;
- create one giant universal field component;
- conflate semantic field configuration with display formatting.

## Tests / evidence

Component tests for representative field kinds and permission/read-only states.

## ADR trigger

None expected.

## Exit gate

The UI has one semantic understanding of field kinds that can be reused by Models and future Dataset/Sheet surfaces.

## Completion evidence

_To be completed by implementing agent._

---

# CORE-01.6 — Establish initial schema capability boundary

**Status:** Planned  
**Blocked by:** CORE-01.3.

## Goal

Introduce the minimum capability distinction needed to separate schema configuration from ordinary Record editing without attempting the complete future role system.

## Why

The product requirement is delegated configuration. CORE-02/03 should not bake owner-only checks or expose schema mutation to all members.

## Deliverables

- explicit capability/permission contract for viewing versus editing/publishing schema definitions at the minimum useful scope;
- PostgreSQL/RLS/RPC enforcement for Model schema mutations;
- application permission state used by Model configuration UI;
- migration path compatible with existing owner/member workspaces;
- tests for permitted and denied schema changes.

## Data/API changes

Expected permission/RPC/RLS changes. Keep them narrow and extensible.

## Must preserve

Existing workspace isolation and ordinary data access.

## Do not

- implement the entire future role matrix;
- rely only on hiding UI controls;
- equate workspace ownership permanently with schema-authoring authority;
- weaken existing owner-only security while introducing capabilities.

## Tests / evidence

DB/RLS tests plus application permission-state tests; fresh migration proof; `pnpm validate`.

## ADR trigger

Required if capability storage/claim mapping introduces a durable new authorisation architecture.

## Exit gate

Schema-edit authority is a distinct server-enforced capability that CORE-02/05 can extend.

## Completion evidence

_To be completed by implementing agent._

---

# CORE-01.7 — Epic proof and CORE-02 hand-off

**Status:** Planned  
**Blocked by:** CORE-01.3 through CORE-01.6.

## Goal

Prove the common kernel is coherent and promote CORE-02 tasks to implementation-ready based on actual evidence.

## Deliverables

- end-to-end examples for at least text, numeric quantity/unit, categorical and Record-reference fields;
- proof that existing Model Records validate and render through canonical semantics;
- Dataset Schema example using the same kernel without production Dataset persistence;
- update architecture/audit docs with final settled contracts;
- required ADRs merged;
- review and refine `tasks/CORE-02.md`;
- update `NEXT.md` to CORE-02.1 only after the epic exit gate passes.

## Data/API changes

Only fixes required to complete prior tasks.

## Must preserve

All Core invariants.

## Do not

- start Dataset storage implementation as part of the proof;
- declare the epic complete with unresolved duplicate type systems.

## Tests / evidence

- `pnpm validate`;
- fresh DB migrate/seed;
- focused DB/API/component tests identified above;
- documented evidence paths in this file.

## Exit gate

A Model property and a Dataset Schema field can use the same reviewed semantic vocabulary for type, units, validation, categorical values and Record relationships; existing Model behaviour remains intact; schema-edit authority is distinct; CORE-02 no longer needs to invent field semantics.

## Completion evidence

_To be completed by implementing agent._

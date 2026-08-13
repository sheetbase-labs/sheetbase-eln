# CORE-01 — Common Schema Kernel

**Status:** Active  
**Current task:** CORE-01.3  
**Normative decisions:** ADRs 0021, 0025, 0026 plus `src/lib/field-definition.ts`.

## Epic goal

Make the existing extensible Model framework and future Dataset Schemas consume one coherent semantic field language without discarding working production contracts.

## Invariants

- PostgreSQL/server validation remains authoritative.
- Existing Model field UUIDs and values are preserved.
- Stable semantic IDs back dependencies; labels/positions do not.
- The common field language does not require identical physical storage.
- Numeric quantity semantics distinguish scientific kind, dimension and canonical storage unit.
- Categories may use embedded options or future reusable governed vocabularies with stable identities.
- Historical values remain interpretable after field/schema evolution.
- Do not implement Dataset physical storage in CORE-01.

---

## CORE-01.1 — Audit current field and schema contracts

**Status:** COMPLETE

**Evidence:** `docs/core/audits/FIELD_SCHEMA_AUDIT.md`

The audit maps the existing Model, scientific table/Dataset schema, validation, unit, category, relationship and calculation contracts and identifies preserve/adapt/deprecate paths.

---

## CORE-01.2 — Define canonical Field Definition contract

**Status:** COMPLETE

**Implementation:** `src/lib/field-definition.ts`  
**Tests:** `src/lib/field-definition.test.ts`

The canonical contract now covers stable identity, logical type, nullability/defaults, cardinality, scientific quantity semantics, validation, embedded/governed category source, relationships, computation and lifecycle, plus compatibility projection from current Model fields.

No production Model persistence is migrated by this task.

---

## CORE-01.3 — Converge existing Model fields onto the kernel

**Status:** Implementation complete — repository validation gate pending
**Blocked by:** Repository-wide pre-existing check, lint, and UI test failures.

### Goal

Make the current production Model framework the first real consumer of canonical `FieldDefinition` semantics without breaking existing Records, field UUIDs, RLS, server-side validation or public API behaviour.

### Existing implementation to inspect

At minimum use the audit and inspect the actual current equivalents of:

- `src/lib/model-fields.ts`;
- Model/field definitions in `src/db/schema.ts`;
- `drizzle/0057_model_fields_foundation.sql` and subsequent related migrations;
- Model field management RPCs and validation functions/triggers;
- category option persistence/lifecycle;
- reference-edge integrity and `targetModelKey` compatibility;
- Samples/Reports custom-property consumers;
- Model Fields configuration UI and tests;
- revision evidence/manifests.

### Deliverables

- production Model code consumes/reuses `FIELD_LOGICAL_TYPES` and canonical semantic types instead of duplicated vocabularies;
- a clear production projection/adapter exists between persisted `record_field_definitions` and `FieldDefinition`;
- relationship/cardinality semantics become explicit while retaining compatibility with current stored `targetModelKey` behaviour;
- current category option IDs/keys/lifecycle remain intact;
- quantity metadata is aligned to ADR 0025 without silently inventing meaning for legacy opaque unit data;
- additive DB migration(s) only where canonical semantics cannot safely be represented by current storage;
- server-authoritative defaults/validation/reference integrity remain intact;
- public API compatibility is preserved or explicitly versioned/migrated;
- focused DB/API/application regression tests;
- `pnpm validate` passes.

### Quantity constraint

Do not treat a unit string as sufficient scientific semantics. The target contract is:

```text
quantity
  kind
  dimension
  storageUnit
  allowedInputUnits?
  preferredDisplayUnit?
```

Legacy unit metadata may remain `legacy-unspecified` until an authorised user/configuration migration supplies scientific meaning. Do not silently infer that `TU/mL`, `%`, `MOI`, etc. are interchangeable merely from mathematical dimension.

CORE-01.3 does **not** need to implement a general conversion engine or full unit-management UI.

### Vocabulary constraint

Preserve current embedded category-option behaviour. Do not build the full reusable Vocabulary product in this task, but do not hard-code the production Model layer in a way that prevents future `vocabularyId`-backed categories.

### Must preserve

- Model/field/option durable IDs;
- existing Record custom values;
- retired/legacy values and revision interpretation;
- RLS/workspace isolation;
- protected base fields;
- current validation/default/reference-edge behaviour;
- idempotent seeds;
- current public behaviour unless an explicit migration requires change.

### Do not

- drop/recreate `record_field_definitions`;
- rewrite applied migrations;
- replace the Model architecture with a new parallel schema system;
- silently reinterpret existing unit metadata;
- implement Dataset persistence;
- build vocabulary administration;
- redesign the Model Fields UI beyond changes needed to represent the truth;
- weaken owner/admin checks before CORE-01.6 introduces a proper capability boundary.

### Tests/evidence

At minimum:

- canonical contract unit tests;
- Model-field adapter/projection tests;
- fresh DB migrate/seed;
- DB validation tests for representative text, quantity metadata, category and reference fields;
- RLS/isolation regression tests;
- reference integrity regression tests;
- existing Sample/Report custom-property UI tests;
- `pnpm validate`.

### ADR trigger

Only add a new ADR if implementation reveals a durable choice not already settled by ADRs 0021/0025/0026, especially if stable identity or physical Model-field storage would materially change.

### Exit gate

Existing production Models/Records use the canonical semantic kernel without loss of identity/data/security/validation, and future Dataset Schema work can consume the same field semantics rather than inventing a second type system.

### Implementation evidence

- Added `drizzle/0060_core_013_model_field_definition_kernel.sql`: additive
  `quantity`, `cardinality`, `category_source`, and `relationship` semantics;
  legacy `targetModelKey` is projected into the explicit relationship and
  remains authoritative for existing reference validation and edges.
- `src/lib/model-fields.ts` now imports the canonical logical-type and semantic
  types and exposes a canonical `definition` projection for every fetched Model
  field. `src/lib/field-definition.ts` consumes persisted explicit semantics
  first and retains the legacy unit projection as `legacy-unspecified`.
- Added adapter and DB regression coverage in
  `src/lib/field-definition.test.ts` and `tests/db/model-fields.test.ts`.
- Updated `.agents/setup` to install PostgreSQL 18 from PGDG when absent. A
  fresh isolated `sheetbase_test` database migrated successfully, then the
  idempotent demo seed completed 29 steps; `pnpm exec vitest run --config vitest.db.config.ts
tests/db/model-fields.test.ts` passes 12/12 tests, including RLS,
  representative text/category/quantity/reference validation and reference
  integrity.
- `pnpm typecheck`, the canonical and adapter unit tests (14/14), `pnpm build`,
  `pnpm db:generate` (no schema changes), and `git diff --check` pass.
- `pnpm validate` was run and remains blocked before typecheck/tests by 114
  pre-existing Prettier violations. Independently, `pnpm lint` has 10
  pre-existing errors in unrelated notebook, Gantt, and experiment-overview
  files; `pnpm test` has five stale UI expectations in
  `scientific-record-linker` and the experiment inspector. These are outside
  CORE-01.3 and must be repaired before this task can be marked complete.

CORE-01.3 must not be marked complete or advance `NEXT.md` until the fresh
database migration/seed, DB regression suite, and a clean `pnpm validate` run
are recorded.

---

## CORE-01.4 — Define Dataset Schema field semantics

**Status:** Planned  
**Blocked by:** CORE-01.3.

Define how Dataset fields consume the same kernel plus Dataset-specific row/shape semantics. No physical Dataset storage yet.

**Exit:** CORE-02 can design Dataset persistence without redefining field meaning.

---

## CORE-01.5 — Unify field rendering/editing semantics

**Status:** Planned  
**Blocked by:** CORE-01.3, CORE-01.4.

Converge semantic renderer/editor selection across Model and future Dataset/Sheet contexts without building one giant universal UI component.

---

## CORE-01.6 — Establish initial schema capability boundary

**Status:** Planned  
**Blocked by:** CORE-01.3.

Separate schema-edit/publish authority from ordinary Record editing through server-enforced capability primitives while preserving current RLS.

---

## CORE-01.7 — Epic proof and CORE-02 hand-off

**Status:** Planned

Prove text, quantity, category and Record-reference semantics through the production Model path, confirm Dataset Schema can consume the same kernel, merge required ADRs/tests, then refine CORE-02 from actual evidence and advance `NEXT.md`.

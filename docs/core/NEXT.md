# Sheetbase Core — Current Work

> **This is the first file an implementation agent should use to decide what to do next.**  
> Keep this file short and update it whenever the active task changes.

## Programme

**Core Data Workspace**

## Active epic

**CORE-01 — Common Schema Kernel**

## Completed in the current PR

- **CORE-01.1 — Audit current field and schema contracts**
  - evidence: [`audits/FIELD_SCHEMA_AUDIT.md`](./audits/FIELD_SCHEMA_AUDIT.md)
- **CORE-01.2 — Define the canonical Field Definition contract**
  - implementation: `src/lib/field-definition.ts`
  - tests: `src/lib/field-definition.test.ts`

## Active task

**CORE-01.3 — Converge existing Model fields onto the kernel**

Task specification: [`tasks/CORE-01.md`](./tasks/CORE-01.md#core-013--converge-existing-model-fields-onto-the-kernel)

## Required reading before work

1. [`PRODUCT_CORE.md`](./PRODUCT_CORE.md)
2. [`CORE_ARCHITECTURE.md`](./CORE_ARCHITECTURE.md)
3. [`CORE_MIGRATION.md`](./CORE_MIGRATION.md)
4. [`audits/FIELD_SCHEMA_AUDIT.md`](./audits/FIELD_SCHEMA_AUDIT.md)
5. [`tasks/CORE-01.md`](./tasks/CORE-01.md)
6. `src/lib/field-definition.ts`
7. existing Model implementation, especially `src/lib/model-fields.ts`, `src/db/schema.ts` and `drizzle/0057_model_fields_foundation.sql`

Competitor research in `docs/references/eln-competitors/` is background/reference material, not normative requirements.

## What to do now

Implement CORE-01.3. Make the existing extensible Model framework the **first production consumer** of the canonical `FieldDefinition` semantics while preserving existing field UUIDs, values, public API behaviour, RLS and server-side validation.

This is production implementation work, not another architecture-only pass. Prefer compatibility/adaptation over replacement. Add DB changes only where the kernel exposes a semantic gap that cannot be represented safely by the existing Model storage.

## Immediate implementation targets

- replace duplicated Model logical-type declarations with the canonical vocabulary;
- add a production adapter/projection between `record_field_definitions` and `FieldDefinition`;
- make relationship/cardinality semantics explicit without breaking current `targetModelKey` compatibility;
- preserve category option IDs/keys and lifecycle;
- preserve current server-authoritative defaults/validation and revision evidence;
- add focused Model/API/DB tests and run `pnpm validate` through CI.

## Do not do yet

- Do not replace the Model framework or recreate field IDs.
- Do not start Dataset physical-storage implementation (CORE-02).
- Do not redesign the Model Fields UI beyond what honest canonical semantics require.
- Do not weaken PostgreSQL validation/RLS.
- Do not expand Analysis, Planner, Calendar, Instruments, Reports, Storage or Plate Designer.

## Completion hand-off

When CORE-01.3 is complete, record migration/API/test evidence in `tasks/CORE-01.md` and advance to CORE-01.4 (Dataset Schema field semantics) unless implementation evidence requires an ADR first.

## Golden programme workflow

All Core work should ultimately support the Lentivector purification Notebook workflow defined in `CORE_MIGRATION.md`: Sample Records + Upstream Results Dataset + Purification Results Dataset + local Observation + calculated Recovery, with Record creation/linking, write-back, Views, provenance and frozen evidence.

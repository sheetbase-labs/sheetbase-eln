# Sheetbase Core — Current Work

> **Implementation agents start here.**

## Programme

**Core Data Workspace**

## Active task

**CORE-01.3 — Converge existing Model fields onto the canonical Field Definition kernel**

Task: [`tasks/CORE-01.md`](./tasks/CORE-01.md#core-013--converge-existing-model-fields-onto-the-kernel)

## Completed in this PR

- CORE-01.1 — current field/schema audit
- CORE-01.2 — executable canonical `FieldDefinition` contract and tests
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

Make the existing PostgreSQL-authoritative Model framework consume canonical `FieldDefinition` semantics while preserving existing IDs, data, RLS, validation, reference integrity and public behaviour.

This is **real production coding**, not another architecture pass.

Key targets:

- remove/reduce duplicated Model logical-type semantics;
- add a production projection/adapter from persisted Model fields to `FieldDefinition`;
- align relationship/cardinality semantics without breaking legacy `targetModelKey` data;
- preserve current embedded category option identities/lifecycle while leaving room for governed vocabularies;
- align unit metadata with ADR 0025 quantity semantics without silently inventing meaning for legacy values;
- add additive migration(s) only if current production storage cannot represent required semantics safely;
- add focused DB/API/application tests and run the full validation gate.

## Do not

- do not redesign the architecture already settled by ADRs 0020–0026;
- do not start Dataset storage (CORE-02);
- do not infer scientific quantity meaning from legacy unit strings;
- do not build the full unit-conversion or vocabulary-management product yet;
- do not replace `record_field_definitions` or recreate durable IDs;
- do not weaken RLS/server validation;
- do not broaden paused specialist workspaces.

## Hand-off

When CORE-01.3 is complete, record concrete completion evidence in `tasks/CORE-01.md` and advance this file to CORE-01.4 unless implementation exposes a genuinely new durable architectural fork requiring an ADR.

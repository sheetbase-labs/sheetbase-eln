# Sheetbase Core — Current Work

> **Implementation agents start here.**

## Programme

**Core Data Workspace**

## Active task

**CORE-01.4 — Define Dataset Schema field semantics**

Task: [`tasks/CORE-01.md`](./tasks/CORE-01.md#core-014--define-dataset-schema-field-semantics)

## Completed in this PR

- CORE-01.1 — current field/schema audit
- CORE-01.2 — executable canonical `FieldDefinition` contract and tests
- CORE-01.3 — Model fields converged on the canonical kernel
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

Define how Dataset Schema fields consume the canonical `FieldDefinition` kernel, including Dataset-specific row and shape semantics. Do not implement Dataset physical storage yet.

This is **real production coding**, not another architecture pass.

Key targets:

- use the same canonical logical types, quantity, category, relationship,
  cardinality, lifecycle, and validation semantics as Models;
- define only Dataset-specific schema/row-shape concerns needed by CORE-02;
- add focused contract tests and run the full validation gate.

## Do not

- do not redesign the architecture already settled by ADRs 0020–0026;
- do not start Dataset storage (CORE-02);
- do not build the full unit-conversion or vocabulary-management product yet;
- do not weaken RLS/server validation;
- do not broaden paused specialist workspaces.

## Hand-off

When CORE-01.4 is complete, record concrete completion evidence in `tasks/CORE-01.md` and advance this file to CORE-01.5 unless implementation exposes a genuinely new durable architectural fork requiring an ADR.

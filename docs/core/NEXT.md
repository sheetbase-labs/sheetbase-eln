# Sheetbase Core — Current Work

> **Implementation agents start here.**

## Programme

**Core Data Workspace**

## Active task

**CORE-02.5 — Add atomic bulk validate/commit operations**

Task: [`tasks/CORE-02.md`](./tasks/CORE-02.md#core-025--add-atomic-bulk-validatecommit-operations)

## Completed in this PR

- CORE-01.1 — current field/schema audit
- CORE-01.2 — executable canonical `FieldDefinition` contract and tests
- CORE-01.3 — Model fields converged on the canonical kernel
- CORE-01.4 — Dataset Schema fields defined through the canonical kernel
- CORE-01.5 — Field rendering/editor selection converged on canonical semantics
- CORE-01.6 — Initial server-enforced schema capability boundary
- CORE-01.7 — Epic proof and CORE-02 hand-off
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

Add controlled, idempotent atomic bulk validation and commit operations for
Dataset rows.

This is **real production coding**, not another architecture pass.

Key targets:

- validate realistic multi-row payloads;
- return structured row/field errors without partial writes;
- preserve optimistic concurrency and retry safety.

## Do not

- do not redesign the architecture already settled by ADRs 0020–0026;
- do not build Sheet UI yet;
- do not build the full unit-conversion or vocabulary-management product yet;
- do not weaken RLS/server validation;
- do not broaden paused specialist workspaces.

## Hand-off

When CORE-02.5 is complete, record concrete completion evidence in
`tasks/CORE-02.md` and advance this file to CORE-02.6.

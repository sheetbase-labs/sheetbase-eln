# Sheetbase Core — Current Work

> **This is the first file an implementation agent should use to decide what to do next.**  
> Keep this file short and update it whenever the active task changes.

## Programme

**Core Data Workspace**

## Active epic

**CORE-01 — Common Schema Kernel**

## Active task

**CORE-01.1 — Audit current field and schema contracts**

Task specification: [`tasks/CORE-01.md`](./tasks/CORE-01.md#core-011--audit-current-field-and-schema-contracts)

## Required reading before work

1. [`PRODUCT_CORE.md`](./PRODUCT_CORE.md)
2. [`CORE_ARCHITECTURE.md`](./CORE_ARCHITECTURE.md)
3. [`CORE_MIGRATION.md`](./CORE_MIGRATION.md)
4. [`tasks/README.md`](./tasks/README.md)
5. [`tasks/CORE-01.md`](./tasks/CORE-01.md)
6. relevant existing ADRs and implementation files identified by CORE-01.1

Competitor research in `docs/references/eln-competitors/` is background/reference material, not normative requirements.

## What to do now

Perform CORE-01.1 as an **audit/documentation task**. Establish exactly which field/schema concepts already exist in the repository and how they map to the proposed common Field Definition kernel.

The task must inspect the actual current implementation rather than designing from memory or only from the Core docs.

## Do not do yet

- Do not create a schema-kernel migration.
- Do not replace or rename the existing `model_fields` architecture.
- Do not change public PostgREST resources/RPCs.
- Do not start CORE-02 Dataset implementation.
- Do not expand Analysis, Planner, Calendar, Instruments, Reports, Storage or Plate Designer.
- Do not redesign the UI.

CORE-01.1 exists specifically to prevent premature implementation choices.

## Completion hand-off

When CORE-01.1 is complete:

1. commit its required audit artefact(s);
2. record concrete file/table/type/RPC references and incompatibilities;
3. identify ADR decisions required by CORE-01.2/01.3;
4. mark CORE-01.1 complete in `tasks/CORE-01.md` with evidence links/paths;
5. update this file so **Active task** becomes `CORE-01.2 — Define the canonical Field Definition contract`;
6. do not silently start CORE-01.2 in the same change unless the task/PR was explicitly scoped to both.

## Golden programme workflow

All Core work should ultimately support the Lentivector purification Notebook workflow defined in `CORE_MIGRATION.md`: Sample Records + Upstream Results Dataset + Purification Results Dataset + local Observation + calculated Recovery, with Record creation/linking, write-back, Views, provenance and frozen evidence.

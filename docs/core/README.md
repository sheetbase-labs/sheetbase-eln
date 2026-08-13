# Sheetbase Core — Agent Continuation Index

This directory defines the current Sheetbase core reset and should be read before substantial new product/domain work.

## If you are here to implement something

Start with [`NEXT.md`](./NEXT.md). It identifies the **single active task**, required reading, explicit non-goals and hand-off procedure.

Implementation task specifications live in [`tasks/`](./tasks/README.md). Do not select work merely because it appears later in the roadmap.

## Canonical reading order

1. [`NEXT.md`](./NEXT.md) — exactly what an implementation agent should do now.
2. [`PRODUCT_CORE.md`](./PRODUCT_CORE.md) — what the core product means and the primitives users interact with.
3. [`CORE_ARCHITECTURE.md`](./CORE_ARCHITECTURE.md) — target technical contracts and constraints.
4. [`CORE_MIGRATION.md`](./CORE_MIGRATION.md) — how the current repository maps to the target, including epics, pauses and implementation order.
5. [`tasks/README.md`](./tasks/README.md) and the active epic task file — executable planning and completion evidence.
6. Repository [`PRODUCT.md`](../../PRODUCT.md) — broader product/design intent that remains valid.
7. Repository [`DESIGN.md`](../../DESIGN.md) — visual/product design system.
8. Repository [`ROADMAP.md`](../../ROADMAP.md) — high-level delivery sequence.
9. Relevant ADRs in `docs/decisions/` before changing settled architectural contracts.
10. [`docs/references/eln-competitors/`](../references/eln-competitors/README.md) when product/architecture work would benefit from established ELN patterns.

Competitor material is **reference evidence, not normative specification**. If it conflicts with `docs/core/`, the Core documents win.

## Current programme

The active programme is **Core Data Workspace**.

High-level epics:

1. **CORE-01 — Common Schema Kernel**
2. **CORE-02 — Dataset Primitive**
3. **CORE-03 — Compositional Sheet**
4. **CORE-04 — Records from Sheets**
5. **CORE-05 — Schema Evolution, Views and Role-aware Configuration**
6. **CORE-06 — Notebook Integration and Frozen Evidence**
7. **AUTO-01 — Pipeline Foundation**
8. **AUTO-02 — Agent-authored Operations**

## Task detail policy

Planning uses progressive elaboration:

- CORE-01 is fully implementation-ready;
- CORE-02 is substantially decomposed and must be reviewed at the CORE-01 exit gate;
- CORE-03 has constrained task skeletons and must be elaborated using CORE-02 evidence;
- CORE-04 through AUTO-02 intentionally contain outcomes/constraints rather than speculative low-level tasks.

This avoids both under-specifying the next agent task and creating a stale long-range backlog based on assumptions that early implementation may invalidate.

## One-sentence architecture

**A Sheet is an Excel-like compositional workspace over one or more Datasets and Model Records, plus local and calculated columns; every value has provenance and every writable value has one authoritative write target.**

## Golden workflow

The programme acceptance workflow is a Notebook Sheet that combines:

- Sample Records;
- an Upstream Results Dataset;
- a Purification Results Dataset;
- a local Observation column;
- a calculated Recovery column;

and supports inline/bulk Sample creation, correct write-back, saved Views, provenance and eventual frozen submission evidence.

## Important existing work to preserve

- PostgreSQL/PostgREST/RLS authority;
- Handsontable spreadsheet interaction;
- HyperFormula calculation trust/provenance decisions;
- the extensible Model framework introduced by PR #27;
- dense registry/inspector UI patterns;
- stable API identities and audit/revision principles.

## Product/market references

The dated competitor research in `docs/references/eln-competitors/` covers Benchling, Dotmatics, Revvity Signals Notebook, SciNote, Labguru and Sapio Sciences, plus cross-product patterns around structured capture, Models/schemas, Templates, permissions, workflows, APIs and AI.

Use it to understand established scientific-informatics patterns and why Sheetbase intentionally separates Model/Dataset/Sheet/Template/Pipeline concepts.

## Work temporarily de-emphasised

Feature expansion in Analysis, Planner, Calendar, Instrument Monitor, Report Builder, Storage and Plate Designer should normally wait until the early Core epics are proven. Bug/security fixes and changes that help convergence are still appropriate.

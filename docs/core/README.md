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
9. Relevant ADRs in `docs/decisions/` before changing settled architectural contracts. **ADR 0020 is mandatory reading before Sheet/Template architecture work.**
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

## One-sentence architecture

**A reusable versioned Sheet Definition describes composition; a Sheet Instance is the working Excel-like surface over one or more independently reusable Datasets and Model Records plus local/calculated columns. Templates reference pinned Definition versions by default, and every writable Instance value has one authoritative write target.**

## Sheet and Template reuse — locked decision

ADR 0020 establishes these invariants:

- Sheet Definition and Sheet Instance are separate first-class concepts;
- multiple Notebook Templates can reuse the same Sheet Definition;
- multiple independent Sheet Instances can be created from one Definition without sharing local values;
- the same Dataset can be reused in many Definitions/Instances/Templates without becoming owned by them;
- Template references pin Definition versions by default;
- publishing a new Definition version does not silently change existing Templates or Instances;
- shared live Sheet Instances and pinned snapshots are supported only through explicit policies.

## Golden workflow

The programme acceptance workflow is a Notebook Sheet Instance that combines Sample Records, an Upstream Results Dataset, a Purification Results Dataset, a local Observation column and a calculated Recovery column, with inline/bulk Sample creation, correct write-back, saved Views, provenance and eventual frozen submission evidence.

CORE-03 must additionally prove reuse/version safety for Sheet Definitions and Notebook Template references.

## Important existing work to preserve

- PostgreSQL/PostgREST/RLS authority;
- Handsontable spreadsheet interaction;
- HyperFormula calculation trust/provenance decisions;
- the extensible Model framework introduced by PR #27;
- dense registry/inspector UI patterns;
- stable API identities and audit/revision principles.

## Product/market references

The dated competitor research in `docs/references/eln-competitors/` covers Benchling, Dotmatics, Revvity Signals Notebook, SciNote, Labguru and Sapio Sciences, plus cross-product patterns around structured capture, Models/schemas, Templates, permissions, workflows, APIs and AI.

## Work temporarily de-emphasised

Feature expansion in Analysis, Planner, Calendar, Instrument Monitor, Report Builder, Storage and Plate Designer should normally wait until the early Core epics are proven. Bug/security fixes and convergence changes are still appropriate.

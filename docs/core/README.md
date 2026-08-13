# Sheetbase Core — Agent Continuation Index

This directory defines the current Sheetbase core reset and should be read before substantial new product/domain work.

## Canonical reading order

1. [`PRODUCT_CORE.md`](./PRODUCT_CORE.md) — what the core product means and the primitives users interact with.
2. [`CORE_ARCHITECTURE.md`](./CORE_ARCHITECTURE.md) — target technical contracts and constraints.
3. [`CORE_MIGRATION.md`](./CORE_MIGRATION.md) — how the current repository maps to the target, including epics, pauses and immediate implementation order.
4. Repository [`PRODUCT.md`](../../PRODUCT.md) — broader product/design intent that remains valid.
5. Repository [`DESIGN.md`](../../DESIGN.md) — visual/product design system.
6. Repository [`ROADMAP.md`](../../ROADMAP.md) — high-level delivery sequence; the Core programme section supersedes older narrow assumptions about one Sheet mapping to one table.
7. Relevant ADRs in `docs/decisions/` before changing settled architectural contracts.

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

See `CORE_MIGRATION.md` for exit gates and implementation order.

## One-sentence architecture

**A Sheet is an Excel-like compositional workspace over one or more Datasets and Model Records, plus local and calculated columns; every value has provenance and every writable value has one authoritative write target.**

## Current engineering priority

Do not broaden specialist workspaces as the default next task. Converge existing work onto Models, Records, Datasets, Sheets, Views, Calculations and capabilities first.

## Golden workflow

The programme acceptance workflow is a Notebook Sheet that combines:

- Sample Records;
- an Upstream Results Dataset;
- a Purification Results Dataset;
- a local Observation column;
- a calculated Recovery column;

and supports inline/bulk Sample creation, correct write-back, saved views, provenance and eventual frozen submission evidence.

## Important existing work to preserve

- PostgreSQL/PostgREST/RLS authority;
- Handsontable spreadsheet interaction;
- HyperFormula calculation trust/provenance decisions;
- the extensible Model framework introduced by PR #27;
- dense registry/inspector UI patterns;
- stable API identities and audit/revision principles.

## Work temporarily de-emphasised

Feature expansion in Analysis, Planner, Calendar, Instrument Monitor, Report Builder, Storage and Plate Designer should normally wait until the early Core epics are proven. Bug/security fixes and changes that help convergence are still appropriate.

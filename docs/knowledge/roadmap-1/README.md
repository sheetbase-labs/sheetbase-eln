# Sheetbase Core — Agent Continuation Index

This directory is the completed **Roadmap 1 / Core Data Workspace** programme and should be read before changing settled Core product/domain architecture.

**Current work is owned by [`../NEXT.md`](../NEXT.md).** The local `NEXT.md` and implementation reviews below are historical evidence, not a competing current queue. Recorded Core closure is retained by the [2026-09-07 reconciliation](../history/2026-09-07-roadmap-reconciliation.md), not independently re-certified by it.

## Canonical reading order

1. [`../NEXT.md`](../NEXT.md) — the single current cross-roadmap hand-off; [`NEXT.md`](NEXT.md) retains detailed historical Core completion evidence.
2. [`PRODUCT_CORE.md`](PRODUCT_CORE.md) — canonical Core product model.
3. [`CORE_ARCHITECTURE.md`](CORE_ARCHITECTURE.md) — target technical contracts and constraints.
4. [`CORE_MIGRATION.md`](CORE_MIGRATION.md) — migration/implementation sequence.
5. [`tasks/README.md`](tasks/README.md) and relevant epic task file.
6. [`../PRODUCT.md`](../PRODUCT.md) — broader canonical product intent.
7. [`../DESIGN.md`](../DESIGN.md) — canonical visual/product design system.
8. [`../ROADMAP.md`](../ROADMAP.md) — roadmap-level orientation.
9. Relevant ADRs in [`../decisions/`](../decisions/). **ADR 0020 is mandatory before Sheet/Template architecture work.**
10. [`../references/eln-competitors/`](../references/eln-competitors/) when established ELN patterns are useful context.

Competitor material is reference evidence, not normative specification. If it conflicts with current Core/ADR/product contracts, the canonical contracts win.

## Programme status

CORE-01–06 and Core Hardening are recorded complete:

1. **CORE-01 — Common Schema Kernel**
2. **CORE-02 — Dataset Primitive**
3. **CORE-03 — Compositional Sheet**
4. **CORE-04 — Records from Sheets**
5. **CORE-05 — Schema Evolution and Role-aware Configuration**
6. **CORE-06 — Notebook Integration and Frozen Evidence**

Roadmap 2 followed Core and its active scope is now recorded closed. Roadmap 3 has merged implementation and explicit outstanding/deferred work. Read [`../NEXT.md`](../NEXT.md) rather than restarting either programme from this historical index.

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

The programme acceptance workflow is a Notebook Sheet Instance combining Sample Records, an Upstream Results Dataset, a Purification Results Dataset, a local Observation column and a calculated Recovery column, with inline/bulk Sample creation, correct write-back, saved presentation state, provenance and eventual frozen submission evidence.

## Important existing work to preserve

- PostgreSQL/PostgREST/RLS authority;
- Handsontable spreadsheet interaction;
- HyperFormula calculation trust/provenance decisions;
- extensible Models and Records;
- dense registry/inspector UI patterns;
- stable API identities and audit/revision principles.

## Product/market references

The dated competitor research in [`../references/eln-competitors/`](../references/eln-competitors/) covers Benchling, Dotmatics, Revvity Signals Notebook, SciNote, Labguru and Sapio Sciences, plus cross-product patterns around structured capture, Models/schemas, Templates, permissions, workflows, APIs and AI.

## Historical note

This file was originally an implementation continuation index. The Core programme is now complete; use it as the Roadmap 1 entry point and implementation record, not as a statement that Core work is currently active.

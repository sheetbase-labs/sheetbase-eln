# Sheetbase roadmap

## Current shape

```text
Roadmap 1              COMPLETE
Roadmap 2              COMPLETE
Roadmap 3              PLANNED / IMPLEMENTATION-READY
```

Current priority and hand-off live in [`NEXT.md`](NEXT.md).

## Destination

Sheetbase is a scientific data workspace where the Notebook provides scientific context and Excel-like Sheet Instances provide the primary structured-data interaction surface while PostgreSQL remains authoritative.

Reusable organisational configuration — Models, Dataset Schemas, Sheet Definitions, Notebook Templates and vocabularies — is separate from scientific working state — Records, Datasets, Notebooks and Sheet Instances.

A Sheet Instance can compose multiple Datasets and Model Records with local and calculated columns. Every value has provenance and every writable value has one authoritative write target.

## Roadmap 1 — Core Data Workspace

[`roadmap-1/`](roadmap-1/) is the complete Roadmap 1 corpus.

Completed epics:

1. CORE-01 — Common Schema Kernel
2. CORE-02 — Dataset Primitive
3. CORE-03 — Compositional Sheet
4. CORE-04 — Records from Sheets
5. CORE-05 — Schema Evolution and Role-aware Configuration
6. CORE-06 — Notebook Integration and Frozen Evidence
7. Core Hardening

The Core programme established the canonical data model, reuse/version semantics, stable identities, Record creation from Sheets, role-aware configuration, Notebook integration, Dataset Versions and frozen evidence.

## Roadmap 2 — Product & Platform Consolidation

[`roadmap-2/`](roadmap-2/) contains the Roadmap 2 programme corpus.

Roadmap 2 is complete. Its streams consolidated the product, data,
collaboration, scientific analysis, integrations, platform, API, governance,
deterministic Pipelines, inspectable agent operations, and bounded agent
workflows.

GOV-02 Organisation Model remains deliberately ADR-gated/deferred.

## Roadmap 3 — Product & Scientific Maturity

[`roadmap-3/`](roadmap-3/) is implementation-ready but not active until [`NEXT.md`](NEXT.md) promotes it.

Roadmap 3 uses the same execution shape as Roadmap 2: a capability stream owns a task file containing sequential numbered tasks plus a matching agent prompt. It currently contains **18 capability streams and 60 discrete tasks**:

1. **Product Depth — 15:** NAV-01..03, GRID-01..05, NOTE-01..04, FIND-01..03
2. **Scientific Depth — 14:** KNOW-01..03, VIEW-01..04, MODEL-01..04, REUSE-01..03
3. **Open Platform — 12:** SDK-01..03, EVENT-01..03, EXT-01..03, ADMIN-01..03
4. **Intelligent Workspace — 9:** AI-01..03, ASSIST-01..03, AUTO-PLUS-01..03
5. **Institutionalise — 10:** ENT-ORG-01..03, GXP-01..04, OPS-01..03

Each numbered task is independently assignable/reviewable and has an explicit goal, scope/boundaries and exit criterion. See [`roadmap-3/PROGRAMME_MAP.md`](roadmap-3/PROGRAMME_MAP.md) and [`roadmap-3/tasks/README.md`](roadmap-3/tasks/README.md).

Governing principle:

> Mature Sheetbase for its own users. Make interoperability a property of the platform, not the reason for the roadmap.

## Golden workflow

Continue to use realistic scientific workflows, including the Lentivector purification example, as cross-roadmap proof.

## Delivery rules

- Build narrow end-to-end slices through DB/RLS/API/UI/tests.
- Stable semantic IDs back durable dependencies.
- PostgreSQL remains authoritative for permissions and durable scientific state.
- Audit history is not a substitute for immutable scientific versions/evidence.
- Shared Sheet Instances are explicit.
- Reuse uses composition, not hidden inheritance or accidental shared state.
- Exploratory local work remains legitimate; promotion into governed structure is explicit.
- The browser is one client of the domain; APIs/SDKs are first-class product surfaces.
- AI and Pipelines use ordinary permissions, validation and provenance rather than bypassing them.
- Add ADRs only for genuine durable architectural forks.
- During pre-release, remove superseded compatibility paths unless a current explicit dependency requires them.

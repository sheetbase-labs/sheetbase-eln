# Sheetbase roadmap

## Current shape

```text
Roadmap 1              COMPLETE
Roadmap 2              NEARLY COMPLETE
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

Completed/substantially completed streams include Product Consolidation, Data, Collaboration, Scientific Analysis & Visualisation, Integrations and Platform maturity, with Governance largely complete.

The remaining Roadmap 2 work is maintained in the repository-wide [`NEXT.md`](NEXT.md), not in a Roadmap-2-local hand-off.

GOV-02 Organisation Model remains deliberately ADR-gated/deferred.

## Roadmap 3 — Product & Scientific Maturity

[`roadmap-3/`](roadmap-3/) is now implementation-ready but not active until [`NEXT.md`](NEXT.md) promotes it.

It contains five programmes and 18 named tasks:

1. **Product Depth** — NAV-01, GRID-01, NOTE-01, FIND-01
2. **Scientific Depth** — KNOW-01, VIEW-01, MODEL-01, REUSE-01
3. **Open Platform** — SDK-01, EVENT-01, EXT-01, ADMIN-01
4. **Intelligent Workspace** — AI-01, ASSIST-01, AUTO-PLUS-01
5. **Institutionalise** — ENT-ORG-01, GXP-01, OPS-01

Each task has explicit scope, non-goals, dependencies, required evidence and an exit criterion. See [`roadmap-3/PROGRAMME_MAP.md`](roadmap-3/PROGRAMME_MAP.md) and [`roadmap-3/tasks/README.md`](roadmap-3/tasks/README.md).

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

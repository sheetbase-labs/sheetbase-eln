# Sheetbase roadmap

## Current shape

```text
Roadmap 1              COMPLETE
Roadmap 2              NEARLY COMPLETE
Roadmap 3              DIRECTION DEFINED
```

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

[`roadmap-2/`](roadmap-2/) contains the active Roadmap 2 execution programme.

Completed/substantially completed streams include Product Consolidation, Data, Collaboration, Scientific Analysis & Visualisation, Integrations and Platform maturity, with Governance largely complete.

Active remainder after SCI-04:

```text
API-04  Python SDK
API-05  TypeScript SDK
API-06  Webhooks
AUTO-04 Agent-authored Operations
AUTO-05 Agentic Scientific Workflows
```

GOV-02 Organisation Model remains deliberately ADR-gated/deferred.

Use [`roadmap-2/NEXT.md`](roadmap-2/NEXT.md) for the current execution hand-off.

## Roadmap 3 — Product and scientific maturity

[`roadmap-3/README.md`](roadmap-3/README.md) captures the current strategic direction after Roadmap 2.

The proposed stages are:

1. **Product Depth** — NAV, GRID, NOTE, FIND
2. **Scientific Depth** — KNOW, VIEW, MODEL, REUSE
3. **Open Platform** — SDK, EVENT, EXT, ADMIN
4. **Intelligent Workspace** — AI, ASSIST, AUTO+
5. **Institutionalise** — ENT-ORG, GXP, OPS

Governing principle:

> Mature Sheetbase for its own users. Make interoperability a property of the platform, not the reason for the roadmap.

Roadmap 3 remains strategic until decomposed into implementation-ready tasks and exit criteria.

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

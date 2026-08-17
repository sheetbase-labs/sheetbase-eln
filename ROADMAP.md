# Sheetbase roadmap

> **Core Data Workspace:** CORE-01–06 and Core Hardening are complete.  
> **Next:** Product & Platform Consolidation. AUTO-01 is deferred.  
> **Post-Core planning authority:** [`docs/roadmap/`](./docs/roadmap/). Start with [`docs/roadmap/NEXT.md`](./docs/roadmap/NEXT.md).  
> **Canonical Core:** [`docs/core/`](./docs/core/) and accepted ADRs.

## Destination

Sheetbase is a scientific data workspace where the Notebook provides scientific context and Excel-like Sheet Instances provide the primary structured-data interaction surface while PostgreSQL remains authoritative.

Reusable organisational configuration — Models, Dataset Schemas, Sheet Definitions, Notebook Templates and vocabularies — is separate from project/workspace scientific working state — Records, Datasets, Notebooks and Sheet Instances.

A Sheet Instance can compose multiple Datasets and Model Records with local and calculated columns. Every value has provenance and every writable value has one authoritative write target.

## Completed foundation

CORE-01–06 and Core Hardening H1–H5 are complete. Detailed implementation history, architecture, audits and evidence remain under [`docs/core/`](./docs/core/).

The completed Core provides:

- a canonical Field Definition/schema kernel;
- user-extensible Models and Records;
- durable Datasets with immutable Dataset Versions;
- compositional and ad-hoc Sheet Instances;
- reusable versioned Sheet Definitions;
- Records from Sheets;
- role-aware configuration and schema evolution;
- versioned Notebook Templates;
- frozen Notebook/Sheet evidence;
- PostgreSQL/RLS authority, stable semantic identities and explicit lifecycle/provenance contracts.

## Post-Core roadmap

Detailed post-Core planning has moved to [`docs/roadmap/`](./docs/roadmap/), organised similarly to the completed Core programme.

The capability programmes are:

1. **PC — Product Consolidation**
2. **API — API & Developer Platform**
3. **DATA — Data Interoperability**
4. **GOV — Identity, Administration & Governance**
5. **COLLAB — Collaboration**
6. **SCI — Scientific Analysis & Visualisation**
7. **INT — Integrations**
8. **PLAT — Platform, Operations & Security**
9. **AUTO — Automation** — deliberately later

The active hand-off is [`docs/roadmap/NEXT.md`](./docs/roadmap/NEXT.md).

## Current next step

See [`docs/roadmap/NEXT.md`](./docs/roadmap/NEXT.md). PC-00 is accepted. Immediate Ready streams are **PC-01** (medium) and **API-01** (low, contract-only). DATA-01 waits on PC-01. GOV-01 and PLAT-03 are queued.

## Golden workflow

Continue to use realistic scientific workflows, including the Lentivector purification example, as cross-programme proof:

```text
Organisation configuration
  Model: Sample
  Dataset Schemas: Upstream Results, Purification Results
  Sheet Definition: Purification Summary

Project working state
  Upstream Dataset
  Purification Dataset
  Notebook
    `-- Sheet Instance
          +-- Sample Records
          +-- both Datasets
          +-- local Observation
          `-- calculated Recovery
```

Post-Core work should make this and other representative workflows excellent through the real product, API and operational surfaces.

## Delivery rules

- Build narrow end-to-end slices through DB/RLS/API/UI/tests.
- Stable semantic IDs back durable dependencies.
- PostgreSQL remains authoritative for permissions and durable scientific state.
- Audit history is not a substitute for immutable scientific versions/evidence.
- Shared Sheet Instances are explicit.
- Reuse uses composition, not hidden inheritance or accidental shared state.
- Exploratory local work remains legitimate; promotion into governed structure is explicit.
- The browser is one client of the domain; APIs/SDKs are first-class product surfaces.
- AI and Pipelines must eventually use ordinary permissions, validation and provenance rather than bypass them.
- Add ADRs only for genuine durable architectural forks.

## Do not start yet

Do not start broad Pipeline or agentic automation merely because the Core substrate exists. `AUTO` remains deferred until canonical human workflows, public operations, service identity, evidence semantics and observability are mature enough to automate safely.

# Sheetbase Post-Core Product Direction

## Purpose

Sheetbase now has a coherent Core Data Workspace. The post-Core programme should turn that foundation into a complete product and platform without inventing competing foundational concepts.

Sheetbase must become:

- an excellent scientist-facing ELN and spreadsheet-like data workspace;
- a coherent data platform with stable APIs and SDKs;
- an interoperable system for files, import, export, search and integrations;
- an administrable and governable platform suitable for organisational use;
- a collaborative scientific workspace;
- a capable analysis and visualisation environment;
- an operationally reliable service;
- and, later, an automation platform for deterministic and agentic transformations.

## Product direction

The durable conceptual model remains:

```text
Model / Field Definition
        |
      Record
        |
Dataset --- Dataset Version
        |
Sheet Definition
        |
Sheet Instance
        |
Notebook --- Notebook Template
        |
Submitted / frozen evidence
```

Scientists should not need to understand this architecture explicitly.

The product should feel like:

```text
Create or open a Notebook
        |
        v
Add a Sheet
        |
        +--> type/paste data immediately
        +--> link existing Samples/Records
        +--> create missing Records
        +--> add existing Datasets
        +--> add local columns
        +--> calculate
        +--> chart/analyse
        +--> promote useful structure when needed
        +--> reuse successful structures as Definitions/Templates
        |
        v
Submit / freeze when scientific work becomes evidence
```

The architecture exists to make that flexible workflow safe, scalable and governable without making scientists perform database administration.

## Principles

### Human workflows before automation

Prove scientist and steward workflows before building broad Pipeline or agent automation. Automation should eventually use the same validated server operations as humans and external clients.

### One canonical path per concept

Compatibility surfaces must not become competing products. Maintain one canonical Dataset Schema system, Template catalogue, Sheet experience, public domain API and capability model.

### PostgreSQL remains authoritative

RLS, workspace isolation, durable state, versions, lifecycle, permissions, provenance and evidence remain server concerns. Client checks improve usability but are not the scientific-integrity or security boundary.

### Stable identity over labels

Durable relationships use stable IDs. Labels, visual row numbers, coordinates and generated names are presentation or local addresses, not semantic identity.

### Exploratory and governed work coexist

Scientists can start loosely. Local Sheet columns, calculations and ad-hoc work are legitimate. Promotion into Models, Dataset Schemas, Sheet Definitions or Templates is explicit.

### Information density without opacity

Prefer dense, efficient scientific workspaces while keeping actions, provenance, state and errors understandable. Do not pursue visual minimalism at the expense of capability.

### Historical interpretation survives change

Later schema, Dataset, Definition or Template changes must not silently reinterpret versioned or frozen evidence.

### APIs are first-class product surfaces

The browser is one client of the Sheetbase domain. Python, TypeScript, integrations, Pipelines and agents should ultimately use coherent domain contracts rather than internal database implementation details.

### Progressive governance

Apply the strongest controls at durable organisational and evidence boundaries. Do not make exploratory scientific work unnecessarily administrative.

### Reuse through composition

Prefer Definitions, Templates, parameters and explicit composition over inheritance or hidden shared state.

## Cross-cutting quality expectations

Every post-Core epic should consider, where relevant:

- accessibility and keyboard operation;
- performance at realistic scientific scale;
- optimistic concurrency and conflict handling;
- retry/idempotency for consequential mutations;
- workspace/organisation isolation;
- stable identities;
- provenance and auditability;
- immutable evidence boundaries;
- API/UI semantic parity;
- lifecycle and dependency handling;
- import/export portability;
- observability and supportability;
- migration and backwards-compatibility policy for public contracts.

## What is deliberately deferred

Until evidence justifies them, do not prioritise:

- a general visual Pipeline builder;
- agentic scientific workflow execution;
- arbitrary user-designed RBAC policy languages;
- Template or Definition inheritance;
- a second Dataset or Sheet abstraction;
- general saved Views as a foundational primitive;
- a broad unit-conversion engine;
- specialist instrument modules without a generic integration contract.

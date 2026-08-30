---
title: Sheetbase System Overview
status: canonical
last_reviewed: 2026-08-30
---

# Sheetbase System Overview

## Conceptual stack

```text
Scientist / Steward / Reviewer
              ↓
     Product interaction layer
 Notebook · Sheet · Dataset · Configure · Analysis
              ↓
      Canonical domain contracts
 Models/Records · Definitions · Versions · Files
              ↓
      Server-authoritative API layer
 RPCs · public API · capabilities · provenance
              ↓
            PostgreSQL
 typed storage · RLS · lifecycle · audit · evidence
```

The browser is one client of this domain. Future SDKs, connectors, Pipelines and agents should use coherent supported contracts rather than bypassing the model.

## Core domain shape

```text
Model / Field Definition
        │
      Record
        │
Dataset ─── Dataset Version
        │
Sheet Definition
        │
Sheet Instance
        │
Notebook ─── Notebook Template
        │
Submitted / frozen evidence
```

This diagram is conceptual rather than a claim that every object is in one ownership chain. It expresses the major reusable and evidence-bearing concepts.

## Product planes

### Scientific work plane

- Notebooks
- Sheets
- Datasets
- Records
- files
- analysis/visualisation
- review/submission

### Steward/configuration plane

- Models and fields
- Dataset schema definitions/versions
- vocabularies/category sources
- Sheet Definitions
- Notebook Templates
- promoted calculations/structure

### Platform/admin plane

- workspace membership/access
- credentials
- connectors
- pipelines
- storage/usage
- audit
- diagnostics/deployment state

The planes use the same canonical capability model. They are not separate security universes.

## Infrastructure invariants

### PostgreSQL is authoritative

RLS, durable state, versions, lifecycle, permissions, provenance and evidence are server concerns. UI hiding improves usability but is not a security boundary.

### Stable identity

Relationships use stable IDs. Display labels, folder placement, visual row numbers and spreadsheet coordinates are not durable semantic identity.

### One canonical path per concept

When a foundational concept is replaced during pre-release, remove the superseded path. Avoid dual schemas, dual APIs or shadow persistence solely for compatibility with development history.

### Deterministic evidence

Submitted/frozen evidence must be reconstructable from pinned immutable state and explicit configuration. Live scientific state may continue changing independently.

### API/UI semantic parity

Anything that becomes a canonical scientific artefact should have a clean domain representation beyond local React state. The browser should not own hidden business semantics that SDKs or agents cannot reproduce.

## Major canonical subsystems after Roadmap 2 work

- canonical Sheet Instance and Sheet Definition system;
- typed Dataset storage, Schema Versions and Dataset Versions;
- Model/Record system;
- Notebook/Template/revision/evidence system;
- canonical files/attachments platform;
- import/export/search;
- ChartSpec scientific visualisation/analysis model;
- public credential/scoped API and OpenAPI;
- generic connector framework;
- deterministic versioned Pipeline framework;
- collaboration presence/comments/notifications layered over Sheetbase-authoritative scientific state;
- platform administration, observability, security and performance foundations.

## Extensibility rule

New capabilities should extend these contracts rather than adding “temporary” second models. Temporary development-era models tend to become permanent unless deliberately removed.

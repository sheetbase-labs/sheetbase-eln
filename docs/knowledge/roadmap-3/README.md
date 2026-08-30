---
title: Roadmap 3 Thinking
status: draft
last_reviewed: 2026-08-30
---

# Roadmap 3 Thinking

This document captures the current post-Roadmap-2 direction discussed during roadmap planning. It is **not yet an execution task list**.

## Governing principle

> Mature Sheetbase for its own users. Make interoperability a property of the platform, not the reason for the roadmap.

Roadmap 3 should read as if no adjacent project exists. Generic interoperability remains important, but Sheetbase should not become ecosystem-integration-led.

## Proposed stages

### 1. Product Depth

Make the everyday scientist workspace excellent.

Candidate capability groups:

```text
NAV   navigation / information architecture
GRID  spreadsheet ergonomics and depth
NOTE  Notebook composition and authoring depth
FIND  discovery / finding / resurfacing work
```

Likely themes:

- faster navigation and workspace orientation;
- deeper spreadsheet keyboard/range/fill/edit workflows;
- better Notebook composition and section manipulation;
- stronger cross-object find/recent/favourite/context flows;
- polish and consistency across mature canonical concepts.

### 2. Scientific Depth

Make Sheetbase increasingly useful as a scientific knowledge/work platform rather than only a structured ELN.

Candidate groups:

```text
KNOW   scientific knowledge and relationships
VIEW   rich scientific views/representations
MODEL  modelling scientific concepts
REUSE  reuse of successful structures/workflows
```

Likely themes include richer relationship navigation, scientific entity context, reusable structures and additional analysis methods driven by real use.

### 3. Open Platform

Make the mature product cleanly extensible.

Candidate groups:

```text
SDK    ergonomic SDKs
EVENT  webhooks/events
EXT    extension/integration model
ADMIN  mature platform administration
```

Roadmap 2 API-04/05/06 begins this direction. The goal is not integration volume; it is a stable platform contract that lets external clients participate without shadow models.

### 4. Intelligent Workspace

Introduce AI where it can exploit Sheetbase context safely.

Candidate groups:

```text
AI      contextual scientific intelligence
ASSIST  embedded assistance
AUTO+   richer agentic automation
```

The strongest opportunities come after the workspace has mature data identity, provenance, scientific views, APIs/events and deterministic operations.

Agents should help users inside canonical workflows rather than creating a parallel chatbot-centric product.

### 5. Institutionalise

Deepen organisational deployment when actual adoption requires it.

Potential themes:

```text
ENT-ORG  organisation/team model
GXP      configurable regulated controls/evidence
OPS      larger-scale operational maturity
```

This stage should be evidence-driven. GOV-02 belongs here unless a concrete earlier need emerges.

## Capability map

```text
                           SHEETBASE
                               │
       ┌───────────────────────┼────────────────────────┐
       │                       │                        │
      UX                    SCIENCE                 PLATFORM
       │                       │                        │
       ▼                       ▼                        ▼

 NAV   ░░░░░░░░░░          KNOW   ░░░░░░░░░░        SDK    ░░░░░░░░░░
 GRID  ░░░░░░░░░░          VIEW   ░░░░░░░░░░        EVENT  ░░░░░░░░░░
 NOTE  ░░░░░░░░░░          MODEL  ░░░░░░░░░░        EXT    ░░░░░░░░░░
 FIND  ░░░░░░░░░░          REUSE  ░░░░░░░░░░        ADMIN  ░░░░░░░░░░

                               │
                               ▼
                         INTELLIGENCE
                              │
                              ▼
                      AI      ░░░░░░░░░░
                      ASSIST  ░░░░░░░░░░
                      AUTO+   ░░░░░░░░░░
```

## Dependency ideas

- GRID and NOTE maturity provide stronger context for embedded assistance.
- Scientific MODEL work improves reuse and SDK semantics.
- SDK maturity precedes a broad extension ecosystem.
- EVENT/webhooks strengthen automation and external coordination.
- ADMIN/OPS maturity supports institutional use.
- Roadmap 2 provenance, permissions, versions and Pipelines are prerequisites for trustworthy agentic operations.

## Roadmap 3 anti-patterns

Do not make the roadmap primarily about:

- integrations with a particular external system;
- infrastructure for its own sake;
- agent features before everyday scientist UX;
- organisation hierarchy before adoption requires it;
- adding dozens of feature categories without improving core workflows.

## Thesis for the next phase

> Sheetbase is the scientific workspace that combines spreadsheet immediacy with structured identity, relationships, provenance, reuse, analysis, automation and evidence.

Roadmap 3 should deepen that product proposition rather than replace it.

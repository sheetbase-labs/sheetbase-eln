---
title: Sheetbase Roadmap 3
status: planned
last_reviewed: 2026-08-30
---

# Roadmap 3 — Product & Scientific Maturity

Roadmap 3 is the implementation-ready programme that follows Roadmap 2.

> **Mature Sheetbase for its own users. Make interoperability a property of the platform, not the reason for the roadmap.**

Roadmap 3 is **planned, not currently active**. Current execution priority is always defined by repository-wide [`../NEXT.md`](../NEXT.md). Do not start Roadmap 3 merely because task files exist here.

## Start here

1. [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) — product thesis and boundaries.
2. [`PROGRAMME_MAP.md`](PROGRAMME_MAP.md) — sequencing, dependencies and Ready rules.
3. [`tasks/README.md`](tasks/README.md) — discrete task index.
4. The relevant programme task file under [`tasks/`](tasks/).
5. Matching programme prompt under [`prompts/`](prompts/) if useful.
6. Relevant canonical architecture docs and accepted ADRs.

## Programme structure

### 1. Product Depth

Make everyday scientist workflows excellent.

- **NAV-01** — Workspace Navigation & Information Architecture
- **GRID-01** — Spreadsheet Interaction Depth
- **NOTE-01** — Notebook Authoring & Composition Depth
- **FIND-01** — Contextual Discovery, Recents & Favourites

### 2. Scientific Depth

Make scientific context, relationships, representations and reuse first-class.

- **KNOW-01** — Scientific Knowledge & Relationship Context
- **VIEW-01** — Rich Scientific Representations
- **MODEL-01** — Scientific Modelling Depth
- **REUSE-01** — Reusable Scientific Structures & Workflows

### 3. Open Platform

Mature the external platform after Roadmap 2 establishes initial SDK/webhook surfaces.

- **SDK-01** — SDK Product Maturity
- **EVENT-01** — Event & Webhook Platform Maturity
- **EXT-01** — Extension Model
- **ADMIN-01** — Mature Platform Administration

### 4. Intelligent Workspace

Add intelligence only through canonical context, permissions and operations.

- **AI-01** — Contextual Scientific Intelligence Substrate
- **ASSIST-01** — Embedded Scientific Assistance
- **AUTO-PLUS-01** — Mature Agentic Operations & Scientific Workflows

### 5. Institutionalise

Add organisational/regulatory/operational complexity only when adoption evidence justifies it.

- **ENT-ORG-01** — Organisation & Team Model
- **GXP-01** — Configurable Regulated Controls & Evidence
- **OPS-01** — Institutional Operational Maturity

## Dependency shape

```text
Roadmap 2 complete
       |
       v
 Product Depth
       |
   +---+---+
   v       v
Science  Platform
   \       /
    \     /
     v   v
 Intelligence
       |
       v
Institutionalise
```

See [`PROGRAMME_MAP.md`](PROGRAMME_MAP.md) for task-level dependencies and recommended waves.

## Relationship to Roadmap 2

Roadmap 3 does not duplicate unfinished Roadmap 2 work:

- API-04/05 deliver the initial Python/TypeScript SDKs; `SDK-01` matures them.
- API-06 delivers initial webhooks; `EVENT-01` matures the event platform.
- AUTO-04/05 establish agent-authored operations/workflows; `AUTO-PLUS-01` matures them.
- deferred GOV-02 is not silently reactivated; `ENT-ORG-01` requires a concrete need and accepted ADR.

## Roadmap 3 invariants

Do not use Roadmap 3 to create:

- a second Sheet/Dataset/Model/Notebook data model;
- another capability system;
- another connector or Pipeline framework;
- another chart specification;
- agent-only scientific state;
- silent Template/Definition upgrades;
- generic Sheet Versions;
- speculative enterprise hierarchy or regulated controls.

## Activation

When Roadmap 2 is complete:

1. reconcile Roadmap 3 against the product as actually merged;
2. confirm task dependencies/non-goals remain correct;
3. select the first assigned task(s);
4. update repository-wide [`../NEXT.md`](../NEXT.md) to make Roadmap 3 current.

Programme folders never own a competing `NEXT.md`.

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
3. [`tasks/README.md`](tasks/README.md) — 60-task index.
4. The relevant capability task file under [`tasks/`](tasks/).
5. Matching capability prompt under [`prompts/`](prompts/) if useful.
6. Relevant canonical architecture docs and accepted ADRs.

## Roadmap 2-style execution model

Roadmap 3 mirrors Roadmap 2:

- each **capability stream** has one task file, e.g. `tasks/GRID.md`;
- that file contains sequential numbered tasks, e.g. GRID-01..05;
- each numbered task is independently assignable/reviewable and owns a concrete exit criterion;
- each capability stream has a matching agent prompt;
- root [`../NEXT.md`](../NEXT.md) decides which numbered task is actually current.

There are **18 capability streams and 60 discrete tasks**.

## Programme structure

### 1. Product Depth — 15 tasks

- **NAV** — NAV-01..03
- **GRID** — GRID-01..05
- **NOTE** — NOTE-01..04
- **FIND** — FIND-01..03

### 2. Scientific Depth — 14 tasks

- **KNOW** — KNOW-01..03
- **VIEW** — VIEW-01..04
- **MODEL** — MODEL-01..04
- **REUSE** — REUSE-01..03

### 3. Open Platform — 12 tasks

- **SDK** — SDK-01..03
- **EVENT** — EVENT-01..03
- **EXT** — EXT-01..03
- **ADMIN** — ADMIN-01..03

### 4. Intelligent Workspace — 9 tasks

- **AI** — AI-01..03
- **ASSIST** — ASSIST-01..03
- **AUTO+** — AUTO-PLUS-01..03

### 5. Institutionalise — 10 tasks

- **ENT-ORG** — ENT-ORG-01..03
- **GXP** — GXP-01..04
- **OPS** — OPS-01..03

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

See [`PROGRAMME_MAP.md`](PROGRAMME_MAP.md) for capability and within-stream task sequencing.

## Relationship to Roadmap 2

Roadmap 3 does not duplicate unfinished Roadmap 2 work:

- API-04/05 deliver the initial Python/TypeScript SDKs; `SDK-01..03` mature them.
- API-06 delivers initial webhooks; `EVENT-01..03` mature the event platform.
- AUTO-04/05 establish agent-authored operations/workflows; `AUTO-PLUS-01..03` mature them.
- deferred GOV-02 is not silently reactivated; ENT-ORG begins with an adoption-gated ADR.

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
2. confirm dependencies/non-goals remain correct;
3. select the first assigned numbered task(s), normally beginning in Product Depth;
4. update repository-wide [`../NEXT.md`](../NEXT.md) to make Roadmap 3 current.

Programme folders never own a competing `NEXT.md`.

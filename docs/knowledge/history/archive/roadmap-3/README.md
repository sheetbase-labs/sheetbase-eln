---
title: Sheetbase Roadmap 3
status: implementation-merged-with-open-verification-and-deferrals
last_reviewed: 2026-09-07
---

# Roadmap 3 — Product & Scientific Maturity

Roadmap 3 follows Roadmap 2 and is no longer planned/unstarted.

> **Mature Sheetbase for its own users. Make interoperability a property of the platform, not the reason for the roadmap.**

At `main` `832d9d6`, **50 tasks have merged implementation, two have proposed
decisions and eight are deferred**. This is not an unqualified completion or
release sign-off. The implementation includes stub-backed AI/assistance and an
unresolved REUSE-02 test failure. Current priority remains defined by
repository-wide [`../NEXT.md`](../../../NEXT.md).

## Start here

1. [`../NEXT.md`](../../../NEXT.md) — current work and outstanding verification.
2. [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) — product thesis and boundaries.
3. [`PROGRAMME_MAP.md`](PROGRAMME_MAP.md) — dependencies and delivery disposition.
4. [`tasks/README.md`](tasks/README.md) — reconciled 60-task status index.
5. The relevant capability task file under [`tasks/`](tasks/).
6. Matching historical capability prompt under [`prompts/`](prompts/) if useful.
7. Relevant canonical architecture docs and accepted ADRs.

The [dated reconciliation record](../../2026-09-07-roadmap-reconciliation.md)
contains evidence and assessment limits. Original task goals and exits are
retained; they have not been weakened to match delivered code.

## Execution model

- Each **capability stream** has one task file, e.g. `tasks/GRID.md`.
- That file contains sequential numbered tasks, e.g. GRID-01..05.
- Each numbered task owns a concrete exit criterion.
- Each capability stream has a matching historical agent prompt.
- Root [`../NEXT.md`](../../../NEXT.md) decides which follow-up is current; prompts and task order are not assignments.

There are **18 capability streams and 60 discrete tasks**.

## Programme structure and disposition

| Programme             | Streams                  | Tasks | Disposition                                                                |
| --------------------- | ------------------------ | ----: | -------------------------------------------------------------------------- |
| Product Depth         | NAV, GRID, NOTE, FIND    |    15 | Implementation merged                                                      |
| Scientific Depth      | KNOW, VIEW, MODEL, REUSE |    14 | Implementation merged; REUSE-02 verification failing                       |
| Open Platform         | SDK, EVENT, EXT, ADMIN   |    12 | Implementation merged; deployment/release evidence is a separate claim     |
| Intelligent Workspace | AI, ASSIST, AUTO+        |     9 | Bounded implementation merged; real model-provider integration outstanding |
| Institutionalise      | ENT-ORG, GXP, OPS        |    10 | 2 proposed decisions, 8 deferred tasks                                     |

## Dependency shape

This is the original dependency shape, not an instruction to restart the waves.

```text
Roadmap 2 active scope closed
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
Institutionalise — adoption/decision gates remain
```

See [`PROGRAMME_MAP.md`](PROGRAMME_MAP.md) for within-stream sequencing and
[`tasks/README.md`](tasks/README.md) for every task's disposition.

## Relationship to Roadmap 2

- API-04/05 delivered initial Python/TypeScript SDKs; SDK-01..03 mature them.
- API-06 delivered initial webhooks; EVENT-01..03 mature the event platform.
- AUTO-04/05 established bounded agent-authored operations/workflows; AUTO-PLUS-01..03 mature those contracts.
- Deferred GOV-02 is not silently reactivated. ENT-ORG-01's ADR-0044 is proposed, not accepted.

## Roadmap 3 invariants

Do not create:

- a second Sheet/Dataset/Model/Notebook data model;
- another capability system;
- another connector or Pipeline framework;
- another chart specification;
- agent-only scientific state;
- silent Template/Definition upgrades;
- generic Sheet Versions;
- speculative enterprise hierarchy or regulated controls.

## Further assignment

The `#127 → … → #162` stack is merged; there is no remaining ordered-merge
queue. Wave D was not implemented by the proposal/deferral PR. ENT-ORG-01 and
GXP-01 need decisions/evidence; ENT-ORG-02/03, GXP-02..04 and OPS-01..03 retain
their explicit gates.

Use root `NEXT.md` for verification and follow-up work. Roadmap 4 remains a
proposal, not an activated implementation programme. Programme folders never
own a competing current `NEXT.md`.

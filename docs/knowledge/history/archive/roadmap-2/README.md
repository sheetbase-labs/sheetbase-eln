# Sheetbase Roadmap 2 — Product & Platform Consolidation

> **Status, reconciled 2026-09-07:** active scope recorded closed; GOV-02 deferred and documented implementation limits remain. Current priority is maintained in [`../NEXT.md`](../../../NEXT.md).

## Purpose

This directory contains the canonical Roadmap 2 programme: scientist-facing product consolidation, public platform, interoperability, governance, collaboration, scientific analysis, integrations, operational maturity and automation.

Roadmap 1/Core is preserved under [`../roadmap-1/`](../roadmap-1/). Roadmap 3 implementation and deferred scope are recorded under [`../roadmap-3/`](../roadmap-3/).

## Start here

1. [`../NEXT.md`](../../../NEXT.md) — current Sheetbase-wide hand-off and priority.
2. [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) — Roadmap 2 product thesis and principles.
3. [`PROGRAMME_MAP.md`](PROGRAMME_MAP.md) — programme scope and dependencies.
4. [`tasks/README.md`](tasks/README.md) — reconciled epic index/status.
5. the relevant task file under [`tasks/`](tasks/).

## Programmes

| Prefix   | Programme                             |
| -------- | ------------------------------------- |
| `PC`     | Product Consolidation                 |
| `API`    | API & Developer Platform              |
| `DATA`   | Data Interoperability                 |
| `GOV`    | Identity, Administration & Governance |
| `COLLAB` | Collaboration                         |
| `SCI`    | Scientific Analysis & Visualisation   |
| `INT`    | Integrations                          |
| `PLAT`   | Platform, Operations & Security       |
| `AUTO`   | Automation                            |

## Current state

Roadmap 2's active scope is recorded closed. This retains the programme's
historical closure; it does not independently re-certify every task exit or
assert production readiness. See the
[reconciliation evidence](../../2026-09-07-roadmap-reconciliation.md).

**GOV-02 — Organisation Model** remains deliberately ADR-gated/deferred. It is
not completed and is not automatically activated by Roadmap 3's merged work.

Known limits remain, including canonical Sheet-cell/range comment anchors,
bounded intake/analysis and recovery protection. The task index names these
rather than implying every capability is unqualifiedly complete.

This folder does not maintain a competing current hand-off. It retains scope,
task definitions, audits and historical implementation evidence. Old task-local
priority or “next” notes must be interpreted against the reconciled index and
repository-wide `NEXT.md`, not treated as assignments.

## Planning model

Roadmap 2 was not a single long queue. Capability tracks progressed in parallel
once dependencies and assignment were clear. Follow-up work must name the unmet
outcome and inspect existing implementation instead of restarting a completed
foundation from old planning text.

## Relationship to canonical knowledge

- [`../NEXT.md`](../../../NEXT.md) — current work across all roadmaps.
- [`../ROADMAP.md`](../../../ROADMAP.md) — high-level roadmap orientation.
- [`../PRODUCT.md`](../../../PRODUCT.md) — canonical product purpose and principles.
- [`../DESIGN.md`](../../../DESIGN.md) — canonical design system.
- [`../decisions/`](../../../decisions/) — ADRs; inspect proposed versus accepted status.
- [`../roadmap-1/`](../roadmap-1/) — completed Core architecture and implementation record.

Task files define delivery scope; accepted ADRs define durable architectural decisions. If implementation exposes a genuinely new architectural fork, record it deliberately rather than changing the architecture silently inside a task.

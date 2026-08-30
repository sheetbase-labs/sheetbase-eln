# Sheetbase Roadmap 2 — Product & Platform Consolidation

> **Status:** active Roadmap 2 planning/execution authority after the completed Core Data Workspace programme.

## Purpose

This directory contains the canonical Roadmap 2 programme: scientist-facing product consolidation, public platform, interoperability, governance, collaboration, scientific analysis, integrations, operational maturity and automation.

Roadmap 1/Core is preserved under [`../core/`](../core/). Roadmap 3 direction is under [`../roadmap-3/`](../roadmap-3/).

## Start here

1. [`NEXT.md`](./NEXT.md) — current hand-off and task status.
2. [`PRODUCT_DIRECTION.md`](./PRODUCT_DIRECTION.md) — Roadmap 2 product thesis and principles.
3. [`PROGRAMME_MAP.md`](./PROGRAMME_MAP.md) — programme sequencing and dependencies.
4. [`tasks/README.md`](./tasks/README.md) — epic index/status.
5. the relevant task file under [`tasks/`](./tasks/).
6. [`prompts/README.md`](./prompts/README.md) — reusable agent starting prompts.

## Programmes

| Prefix | Programme |
| --- | --- |
| `PC` | Product Consolidation |
| `API` | API & Developer Platform |
| `DATA` | Data Interoperability |
| `GOV` | Identity, Administration & Governance |
| `COLLAB` | Collaboration |
| `SCI` | Scientific Analysis & Visualisation |
| `INT` | Integrations |
| `PLAT` | Platform, Operations & Security |
| `AUTO` | Automation |

## Current state

The major product/platform streams are complete or substantially complete. After SCI-04, the active Roadmap 2 remainder is:

- **API-04 — Python SDK**
- **API-05 — TypeScript SDK**
- **API-06 — Webhooks**
- **AUTO-04 — Agent-authored Operations**
- **AUTO-05 — Agentic Scientific Workflows**

**GOV-02 — Organisation Model** remains deliberately ADR-gated/deferred rather than an automatic completion requirement.

Use [`NEXT.md`](./NEXT.md) as the execution hand-off when its status is more recent than this overview.

## Planning model

Roadmap 2 is not a single long queue. Capability tracks may progress in parallel once dependencies and assignment are clear. Agents should take whole named tasks rather than ambiguous fractions of adjacent tasks.

## Relationship to canonical knowledge

- [`../ROADMAP.md`](../ROADMAP.md) — high-level Roadmaps 1–3 orientation.
- [`../PRODUCT.md`](../PRODUCT.md) — canonical product purpose and principles.
- [`../DESIGN.md`](../DESIGN.md) — canonical design system.
- [`../decisions/`](../decisions/) — accepted ADRs and decision context.
- [`../core/`](../core/) — completed Roadmap 1/Core architecture and implementation record.

Task files define delivery scope; accepted ADRs define durable architectural decisions. If implementation exposes a genuinely new architectural fork, record it deliberately rather than changing the architecture silently inside a task.

---
title: Sheetbase Development Knowledge Base
status: canonical
last_reviewed: 2026-08-30
---

# Sheetbase Development Knowledge Base

`docs/knowledge/` is the canonical home for Sheetbase product, design, roadmaps, ADRs, historical concepts/mockups, reference research, architectural context and development guidance.

## Start here

For substantial product or engineering work:

1. [`agent/agent-context.md`](agent/agent-context.md)
2. [`agent/workflows.md`](agent/workflows.md) — how to review PRs, propose work and implement changes
3. [`PRODUCT.md`](PRODUCT.md)
4. [`DESIGN.md`](DESIGN.md)
5. [`ROADMAP.md`](ROADMAP.md)
6. [`product/product-thesis.md`](product/product-thesis.md)
7. [`decisions/context/canonical-decisions.md`](decisions/context/canonical-decisions.md)
8. [`decisions/context/retired-approaches.md`](decisions/context/retired-approaches.md)
9. the relevant architecture document
10. the active Roadmap 2 hand-off/task, if working on Roadmap 2
11. relevant ADRs under [`decisions/`](decisions/)

Use [`agent/qmd.md`](agent/qmd.md) for local knowledge search. The repository includes a project-local [`.qmd/index.yml`](../../.qmd/index.yml) that indexes `docs/knowledge/**/*.md` as the `sheetbase-knowledge` collection.

## Canonical structure

```text
docs/knowledge/
├── README.md
├── PRODUCT.md
├── DESIGN.md
├── ROADMAP.md
├── product/
├── architecture/
├── design/
├── decisions/
│   ├── 0001-....md          # ADRs
│   └── context/             # cross-cutting decision summaries
├── roadmap-1/               # Core Data Workspace
├── roadmap-2/               # Product & Platform Consolidation
├── roadmap-3/               # post-Roadmap-2 direction
├── concepts/                # historical runnable concepts/prototypes
├── mockups/                 # historical visual design/product artefacts
├── references/
│   ├── eln-competitors/     # dated competitor evidence
│   └── competitor-learnings.md
├── history/
│   ├── archive/             # superseded planning pointers/history
│   └── sci-*.md             # pre-Core scientific programme evidence/plans
└── agent/
    ├── agent-context.md
    ├── development-rules.md
    ├── workflows.md
    └── qmd.md
```

## Product and design

- [`PRODUCT.md`](PRODUCT.md) — canonical users, product purpose, boundaries, personality, design principles and accessibility expectations.
- [`DESIGN.md`](DESIGN.md) — canonical visual and interaction system.
- [`product/product-thesis.md`](product/product-thesis.md) — durable product thesis and long-term positioning.
- [`product/original-requirements.md`](product/original-requirements.md) — requirements that seeded Roadmap 1/Core.
- [`product/core-concepts.md`](product/core-concepts.md) — Notebook, Sheet, Dataset, Model, Record, Definition and Version semantics.
- [`product/ux-principles.md`](product/ux-principles.md)
- [`product/non-goals.md`](product/non-goals.md)
- [`design/ui-system-v2.md`](design/ui-system-v2.md) — durable historical design ideas extracted from the original UI-system work.

## Architecture and decisions

- [`architecture/system-overview.md`](architecture/system-overview.md)
- [`architecture/data-model.md`](architecture/data-model.md)
- [`architecture/sheets.md`](architecture/sheets.md)
- [`architecture/evidence-versioning.md`](architecture/evidence-versioning.md)
- [`architecture/permissions-api-automation.md`](architecture/permissions-api-automation.md)
- [`architecture/scientific-analysis.md`](architecture/scientific-analysis.md)

Accepted ADRs live directly under [`decisions/`](decisions/). Cross-cutting summaries and retired/open decision context live under [`decisions/context/`](decisions/context/).

## Roadmaps

### Roadmap 1 — Core Data Workspace

[`roadmap-1/`](roadmap-1/) is the complete Roadmap 1 corpus: CORE-01–06, Core Hardening, tasks, audits, architecture, migration and implementation review.

### Roadmap 2 — Product & Platform Consolidation

[`roadmap-2/`](roadmap-2/) is the active Roadmap 2 execution corpus. Start with [`roadmap-2/NEXT.md`](roadmap-2/NEXT.md).

### Roadmap 3

[`roadmap-3/README.md`](roadmap-3/README.md) captures the current post-Roadmap-2 direction. It is strategic until decomposed into implementation tasks.

## Concepts and mockups

- [`concepts/`](concepts/) contains historical runnable concepts/prototypes, including the original UI-system prototype and its detailed reference inventory. These are design/product archaeology, not production implementation authority.
- [`mockups/`](mockups/) contains historical visual product/design artefacts. They are evidence of design evolution, not stronger than current `PRODUCT.md`, `DESIGN.md`, ADRs or implemented product contracts.

## References and history

- [`references/eln-competitors/`](references/eln-competitors/) — dated competitor research.
- [`references/competitor-learnings.md`](references/competitor-learnings.md) — durable lessons drawn from that research.
- [`history/evolution-of-sheetbase.md`](history/evolution-of-sheetbase.md)
- [`history/conversation-synthesis.md`](history/conversation-synthesis.md)
- [`history/archive/`](history/archive/) — superseded planning material retained only for historical investigation.
- `history/sci-009-virus-stability-acceptance.md`, `history/sci-010-dataset-schema-registry-plan.md` and `history/sci-011-schema-relationships-plan.md` — pre-Core scientific programme evidence/plans retained as historical context, not current architecture.

## Agent workflow and search

- [`agent/workflows.md`](agent/workflows.md) defines the expected process for PR review, proposing roadmap/product work, implementation and hand-off.
- [`agent/development-rules.md`](agent/development-rules.md) contains cross-cutting engineering constraints.
- [`agent/qmd.md`](agent/qmd.md) describes qmd search, retrieval and MCP use.

Search is a discovery layer only. Agents must open the relevant roadmap task, ADR and canonical source documents in full before making consequential judgements.

## Implementation documentation

Operational and subsystem-specific documentation remains directly under `docs/` when its primary purpose is to document the running implementation rather than durable product/roadmap knowledge. This includes deployment, authentication, testing, current API contracts, database access, pipelines, integrations, observability, performance, security, migration/seeding and current subsystem behaviour.

`docs/assets/` remains outside the knowledge base because it contains implementation/PR documentation assets rather than durable product knowledge. `docs/openapi/` remains outside because it is a generated/executable API contract.

## Authority

When documents disagree:

1. executable server contract and accepted ADR;
2. current canonical `PRODUCT.md`, `DESIGN.md`, roadmap documents and subsystem contracts;
3. cross-cutting knowledge-base synthesis;
4. historical conversation, concept, competitor, mockup or superseded planning material.

## Maintenance

Update this knowledge base when a change materially alters the product model, roadmap direction, architecture, a durable decision or the interpretation of historical work. Avoid accumulating duplicate summaries that merely restate an existing canonical document.

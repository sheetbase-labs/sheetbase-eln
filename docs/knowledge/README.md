---
title: Sheetbase Development Knowledge Base
status: canonical
last_reviewed: 2026-08-30
---

# Sheetbase Development Knowledge Base

`docs/knowledge/` is the canonical home for Sheetbase product, design, roadmaps, ADRs, historical concepts/mockups, reference research, architectural context and development guidance.

## Start here

For substantial product or engineering work:

1. [`NEXT.md`](NEXT.md) — the single current hand-off across Roadmaps
2. [`agent/agent-context.md`](agent/agent-context.md)
3. [`agent/workflows.md`](agent/workflows.md) — how to review PRs, propose work and implement changes
4. [`PRODUCT.md`](PRODUCT.md)
5. [`DESIGN.md`](DESIGN.md)
6. [`ROADMAP.md`](ROADMAP.md)
7. [`product/product-thesis.md`](product/product-thesis.md)
8. [`decisions/context/canonical-decisions.md`](decisions/context/canonical-decisions.md)
9. [`decisions/context/retired-approaches.md`](decisions/context/retired-approaches.md)
10. the relevant architecture and roadmap task documents
11. relevant ADRs under [`decisions/`](decisions/)

Use [`agent/qmd.md`](agent/qmd.md) for local knowledge search. The repository includes a project-local [`.qmd/index.yml`](../../.qmd/index.yml) that indexes `docs/knowledge/**/*.md` as the `sheetbase-knowledge` collection.

## Canonical structure

```text
docs/knowledge/
├── README.md
├── NEXT.md                  # one current cross-roadmap hand-off
├── PRODUCT.md
├── DESIGN.md
├── ROADMAP.md
├── product/
├── architecture/
├── design/
├── decisions/
│   ├── 0001-....md          # ADRs
│   └── context/
├── roadmap-1/               # complete
├── roadmap-2/               # nearly complete / currently active
├── roadmap-3/               # planned and implementation-ready, not active
│   ├── PRODUCT_DIRECTION.md
│   ├── PROGRAMME_MAP.md
│   ├── tasks/
│   └── prompts/
├── concepts/
├── mockups/
├── references/
├── history/
└── agent/
```

## Current work

[`NEXT.md`](NEXT.md) is the only current hand-off file. Programme folders contain scope, task definitions, prompts, audits and historical completion evidence, but they do not own competing `NEXT.md` files.

When merged reality changes what is active or next, update the root `NEXT.md`.

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

[`roadmap-2/`](roadmap-2/) is the Roadmap 2 programme corpus. Current work is tracked only in [`NEXT.md`](NEXT.md); programme-specific task definitions remain under `roadmap-2/tasks/`.

### Roadmap 3 — Product & Scientific Maturity

[`roadmap-3/`](roadmap-3/) is now implementation-ready but deliberately inactive until [`NEXT.md`](NEXT.md) promotes it after Roadmap 2 closes.

Roadmap 3 contains five programmes and 18 named tasks with explicit scope, non-goals, dependencies, required evidence and exit criteria. Start with [`roadmap-3/PRODUCT_DIRECTION.md`](roadmap-3/PRODUCT_DIRECTION.md), [`roadmap-3/PROGRAMME_MAP.md`](roadmap-3/PROGRAMME_MAP.md) and [`roadmap-3/tasks/README.md`](roadmap-3/tasks/README.md).

## Concepts, mockups, references and history

- [`concepts/`](concepts/) contains historical runnable concepts/prototypes. These are design/product archaeology, not production authority.
- [`mockups/`](mockups/) contains historical visual product/design artefacts.
- [`references/eln-competitors/`](references/eln-competitors/) contains dated competitor research; [`references/competitor-learnings.md`](references/competitor-learnings.md) records durable lessons.
- [`history/`](history/) contains product evolution, conversation synthesis and superseded planning/evidence.

## Agent workflow and search

- [`agent/workflows.md`](agent/workflows.md) defines PR review, proposal, implementation and hand-off workflows.
- [`agent/development-rules.md`](agent/development-rules.md) contains cross-cutting engineering constraints.
- [`agent/qmd.md`](agent/qmd.md) describes qmd search, retrieval and MCP use.

Search is discovery only. Agents must open `NEXT.md`, the relevant task, ADR and canonical source documents in full before making consequential judgements.

## Implementation documentation

Operational and subsystem-specific documentation remains directly under `docs/` when its primary purpose is to document the running implementation rather than durable product/roadmap knowledge. This includes deployment, authentication, testing, current API contracts, database access, pipelines, integrations, observability, performance, security, migration/seeding and current subsystem behaviour.

`docs/assets/` remains outside the knowledge base because it contains implementation/PR documentation assets. `docs/openapi/` remains outside because it is a generated/executable API contract.

## Authority

When documents disagree:

1. executable server contract and accepted ADR;
2. current canonical `PRODUCT.md`, `DESIGN.md`, roadmap documents and subsystem contracts;
3. cross-cutting knowledge-base synthesis;
4. historical conversation, concept, competitor, mockup or superseded planning material.

For current priority/status, `NEXT.md` wins over programme-local status text.

## Maintenance

Update this knowledge base when a change materially alters the product model, roadmap direction, architecture, a durable decision or the interpretation of historical work. Avoid accumulating duplicate summaries that merely restate an existing canonical document.

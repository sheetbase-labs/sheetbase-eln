---
title: Sheetbase Development Knowledge Base
status: canonical
last_reviewed: 2026-09-07
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
│   ├── 0001-....md          # ADRs; inspect each decision's status
│   └── context/
├── roadmap-1/               # recorded complete; local NEXT is historical
├── roadmap-2/               # active scope closed; GOV-02 deferred
├── roadmap-3/               # A–C merged; Wave D proposed/deferred
│   ├── PRODUCT_DIRECTION.md
│   ├── PROGRAMME_MAP.md
│   ├── tasks/               # 18 streams / 60 tasks; qualified status index
│   └── prompts/             # historical execution prompts, not assignments
├── roadmap-4/               # merged to main (85/85 active tasks done, 6 cancelled); acceptance limits recorded
├── roadmap-5/               # 22 interface tasks implemented; programme acceptance outstanding
├── mockups/
├── references/
├── history/                 # includes dated reconciliation evidence
└── agent/
```

## Current work

[`NEXT.md`](NEXT.md) is the repository-wide hand-off: it decides which roadmap is active and what is next across roadmaps. Programme folders contain scope, task definitions, prompts, audits and historical completion evidence, but they do not own competing current work queues, with one deliberate exception: Roadmap 4 is self-contained, with its own [`roadmap-4/NEXT.md`](roadmap-4/NEXT.md) and task tracker, which own its queue once the root `NEXT.md` activates it; that activation has happened and the programme is merged. [`roadmap-5/`](roadmap-5/README.md) records 22 implemented interface tasks and keeps no queue: its programme map is implementation status, not an assignment or an acceptance certificate.

The [7 September 2026 reconciliation](history/2026-09-07-roadmap-reconciliation.md)
records the checked baseline, implementation dispositions, outstanding work and
verification limits. It is supporting historical evidence, not another current
hand-off. It predates Roadmap 4's activation; the current hand-off activates it.

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
- [`design/ui-system-v3/`](design/ui-system-v3/README.md) — verbatim snapshot of the current design (126 screens and the design system); adoption proposed by Roadmap 4 and ADR-0047.
- [`design/component-comparison-record.md`](design/component-comparison-record.md) — one row per registry component compared against ours (ADR-0055), with the checklist result for each side and the decision; produced by the `/component-compare` harness.

## Architecture and decisions

- [`architecture/system-overview.md`](architecture/system-overview.md)
- [`architecture/data-model.md`](architecture/data-model.md)
- [`architecture/sheets.md`](architecture/sheets.md)
- [`architecture/evidence-versioning.md`](architecture/evidence-versioning.md)
- [`architecture/permissions-api-automation.md`](architecture/permissions-api-automation.md)
- [`architecture/scientific-analysis.md`](architecture/scientific-analysis.md)

ADRs live directly under [`decisions/`](decisions/). Read each decision's status:
ADR-0044 remains proposed; ADR-0045 was accepted through Roadmap 4 DEC-04. Cross-cutting summaries and
retired/open decision context live under [`decisions/context/`](decisions/context/).

## Roadmaps

### Roadmap 1 — Core Data Workspace

[`roadmap-1/`](roadmap-1/) is the completed Roadmap 1 corpus: CORE-01–06, Core Hardening, tasks, audits, architecture, migration and implementation review. Its recorded closure is retained, not independently re-certified by the reconciliation.

### Roadmap 2 — Product & Platform Consolidation

[`roadmap-2/`](roadmap-2/) retains the Roadmap 2 programme corpus. Active scope is
recorded closed; GOV-02 remains deferred and documented implementation limits
remain. [Task status](roadmap-2/tasks/README.md) supersedes the old early-programme
queue. Programme-specific task contracts remain under `roadmap-2/tasks/`.

### Roadmap 3 — Product & Scientific Maturity

[`roadmap-3/`](roadmap-3/) is no longer planned/unstarted. Of its **18 streams and
60 tasks**, the September baseline records 50 with merged implementation,
two proposed decisions and eight deferred. ADR-0045 was subsequently accepted
through DEC-04; ADR-0044 remains proposed. Merged implementation includes limited/stub-backed capabilities
and does not establish independent acceptance of every exit. REUSE-02 has
a historical baseline failure, not a freshly reproduced result; current
equivalent workflow acceptance remains unverified.

Start with [`roadmap-3/PRODUCT_DIRECTION.md`](roadmap-3/PRODUCT_DIRECTION.md),
[`roadmap-3/PROGRAMME_MAP.md`](roadmap-3/PROGRAMME_MAP.md) and
[`roadmap-3/tasks/README.md`](roadmap-3/tasks/README.md). Original task goals and
exits remain intact. Read current status before reusing an old agent prompt.

### Roadmap 4 — Design-led Product (merged to main)

[Roadmap 4](roadmap-4/README.md) contains 17 streams and 86 original tasks. All
85 active tasks are done and merged to `main` as `10a84a42` (PR #220, 11 October
2026); SHELL-04 is cancelled in favour of DEC-03. The
[2 October source reconciliation](roadmap-4/RECONCILIATION.md) and its limits
still stand: task completion is not release acceptance, and the deferred visual
and browser layers remain unverified. Start with [its current
handoff](roadmap-4/NEXT.md).

### Roadmap 5 — App-3 Interface Closure (proposed)

[`roadmap-5/`](roadmap-5/) records what the app-3 interface build
(`sheetbase-app-ui-only`) has that the ELN does not, audited against `main` at
`10a84a42` on 11 October 2026: **21 proposed tasks across six streams**. It adds
no architecture — most findings are surfaces over data the ELN already writes.
Read [the findings](roadmap-5/FINDINGS.md), the
[programme map](roadmap-5/PROGRAMME_MAP.md) and the
[guide](roadmap-5/GUIDE.md). This corpus keeps no task queue of its own.

[Complete scientific workflows](../../plans/roadmap-5/README.md) remains a
separate, unnumbered proposal about scientific depth; it no longer owns the
Roadmap 5 number. Its overlapping requirements retain Roadmap 4 task ownership.

## Mockups, references and history

- [`mockups/`](mockups/) contains historical visual product/design artefacts.
- [`references/eln-competitors/`](references/eln-competitors/) contains dated competitor research; [`references/competitor-learnings.md`](references/competitor-learnings.md) records durable lessons.
- [`history/`](history/) contains product evolution, conversation synthesis, superseded planning/evidence and dated reconciliations.

## Agent workflow and search

- [`agent/workflows.md`](agent/workflows.md) defines PR review, proposal, implementation and hand-off workflows.
- [`agent/development-rules.md`](agent/development-rules.md) contains cross-cutting engineering constraints.
- [`agent/qmd.md`](agent/qmd.md) describes qmd search, retrieval and MCP use.

Search is discovery only. Agents must open `NEXT.md`, the relevant numbered task, ADR and canonical source documents in full before making consequential judgements.

## Implementation documentation

Implementation documentation is grouped under `docs/api/`, `docs/development/`,
`docs/operations/`, and `docs/subsystems/`. See [`../README.md`](../README.md)
for the index.

`docs/api/openapi/` remains outside the knowledge base because it is a
generated/executable API contract.

## Authority

When documents disagree:

1. executable server contract and accepted ADR;
2. current canonical `PRODUCT.md`, `DESIGN.md`, roadmap documents and subsystem contracts;
3. cross-cutting knowledge-base synthesis;
4. historical conversation, concept, competitor, mockup or superseded planning material.

For current priority/status, `NEXT.md` wins over programme-local historical
notes. A merge flag does not override an unmet task exit or a failing check.

## Maintenance

Update this knowledge base when a change materially alters the product model, roadmap direction, architecture, a durable decision or the interpretation of historical work. Avoid accumulating duplicate summaries that merely restate an existing canonical document.

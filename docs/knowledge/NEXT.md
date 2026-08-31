---
title: Sheetbase Current Work
status: canonical
last_reviewed: 2026-08-30
---

# Sheetbase — Current Work

This is the single current hand-off for Sheetbase development across roadmaps. Start here when deciding what work is active or next.

Do not infer current priority from historical roadmap task ordering, old hand-off text, open branches or unmerged PR descriptions.

## Current programme state

```text
Roadmap 1    COMPLETE
Roadmap 2    COMPLETE
Roadmap 3    ACTIVE — Product Depth
```

## Roadmap 2 closure

The final active Roadmap 2 tasks are complete:

```text
✓ AUTO-04 — Agent-authored Operations
✓ AUTO-05 — Agentic Scientific Workflows
```

AUTO-05 adds bounded digest-pinned multi-step workflows over AUTO-04 proposals.
Product contracts: [`docs/agent-operations.md`](../agent-operations.md) and
[`docs/agent-workflows.md`](../agent-workflows.md). Each operation retains
canonical permissions, provenance, and evidence. This closes Roadmap 2 without
adding the adaptive agent planning and autonomy assigned to Roadmap 3.

### Roadmap 2 deferral carried forward

**GOV-02 — Organisation Model** was not required to close Roadmap 2. Roadmap 3
revisits the need through ENT-ORG-01's adoption-gated ADR before any ownership
or RLS topology changes.

## Active Roadmap 3 work

Roadmap 3 is active. The initial Product Depth wave contains three independent
assigned tasks:

```text
▶ NAV-01  — Canonical Navigation Model
▶ GRID-01 — Keyboard & Selection Model
▶ NOTE-01 — Authoring Interaction Baseline
```

These tasks may proceed in parallel. Each owns its complete numbered-task exit
criterion and must reconcile the current implementation before editing. FIND
follows the NAV foundation; later streams become Ready only when their explicit
dependencies and gates are satisfied.

### Open Platform stream

The SDK stream follows Roadmap 2's API-04/05 foundation:

```text
▶ SDK-01 — Contract Coverage & Parity
▶ SDK-02 — Scientific Developer Ergonomics
```

SDK-01 establishes the explicit support matrix and contract parity tests and
must merge before SDK-02, which builds representative scientific workflows
(dataframe/analysis helpers, bulk transfer, version access and provenance
ergonomics) on that matrix. SDK-02 does not start SDK-03 implicitly.

### Programme scope decisions

- ENT-ORG and GXP remain in scope. Their first tasks must establish and accept
  the required organisation-domain ADR and regulated intended-use/control model
  before implementation proceeds.
- OPS is deferred. Do not start OPS-01..03 without a later explicit programme
  decision based on institutional scale/adoption evidence.
- All other Roadmap 3 streams remain planned according to
  [`roadmap-3/PROGRAMME_MAP.md`](roadmap-3/PROGRAMME_MAP.md); roadmap ordering
  alone does not make their numbered tasks current.

Do not create a Roadmap-3-local `NEXT.md`.

## When taking a task

Read, in order:

1. [`agent/agent-context.md`](agent/agent-context.md)
2. [`agent/workflows.md`](agent/workflows.md)
3. [`PRODUCT.md`](PRODUCT.md)
4. [`DESIGN.md`](DESIGN.md)
5. [`ROADMAP.md`](ROADMAP.md)
6. the relevant roadmap programme/task file;
7. relevant architecture documents and accepted ADRs;
8. current implementation/subsystem docs under `docs/`.

Then inspect the actual code and tests. Documentation is context and contract, not a substitute for implementation evidence.

## Maintenance rule

Update `docs/knowledge/NEXT.md` whenever merged reality materially changes what is active or next. Programme folders retain their own scope, task definitions and historical completion evidence; they do **not** own a competing current hand-off file.

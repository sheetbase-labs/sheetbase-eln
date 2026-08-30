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
Roadmap 2    NEARLY COMPLETE
Roadmap 3    STRATEGIC — not yet an execution task set
```

## Active Roadmap 2 remainder

The substantive Roadmap 2 work still to complete is:

```text
▶ AUTO-04 — Agent-authored Operations
  AUTO-05 — Agentic Scientific Workflows
```

These are whole named tasks. Do not implement ambiguous fractions of adjacent tasks or broaden one task into another without an explicit planning decision.

### Deferred, not active

**GOV-02 — Organisation Model** remains deliberately ADR-gated/deferred. It is not required to declare Roadmap 2 complete unless a concrete product need causes that decision to be revisited.

## Recommended sequence

1. **AUTO-04 — Agent-authored Operations**
2. **AUTO-05 — Agentic Scientific Workflows**

API-04 (Python SDK), API-05 (TypeScript SDK), and API-06 (Webhooks) are complete. The external platform surface is now complete. AUTO-04/05 should build on the existing canonical Pipeline, permission, provenance, evidence and API contracts rather than create parallel agent-only models.

## After Roadmap 2

Roadmap 3 currently defines strategic capability groups rather than implementation-ready tasks. Before starting Roadmap 3 implementation:

1. reconcile the strategic direction against the final Roadmap 2 product;
2. convert Roadmap 3 into a programme map with named tasks, dependencies and exit criteria;
3. prioritise Product Depth and Scientific Depth from real product gaps rather than simply continuing old task numbering;
4. update this file so it remains the single current hand-off.

See [`roadmap-3/README.md`](roadmap-3/README.md) for the current strategic direction.

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

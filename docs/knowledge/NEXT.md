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
Roadmap 3    PLANNED / IMPLEMENTATION-READY — not active
```

## Active Roadmap 2 remainder

The substantive Roadmap 2 work still to complete is:

```text
▶ API-04 — Python SDK
  API-05 — TypeScript SDK
  API-06 — Webhooks
  AUTO-04 — Agent-authored Operations
  AUTO-05 — Agentic Scientific Workflows
```

These are whole named tasks. Do not implement ambiguous fractions of adjacent tasks or broaden one task into another without an explicit planning decision.

### Deferred, not active

**GOV-02 — Organisation Model** remains deliberately ADR-gated/deferred. It is not required to declare Roadmap 2 complete unless a concrete product need causes that decision to be revisited.

## Recommended sequence

1. **API-04 — Python SDK**
2. **API-05 — TypeScript SDK**
3. **API-06 — Webhooks**
4. **AUTO-04 — Agent-authored Operations**
5. **AUTO-05 — Agentic Scientific Workflows**

The SDK/event work completes the external platform surface needed for richer automation. AUTO-04/05 should build on the existing canonical Pipeline, permission, provenance, evidence and API contracts rather than create parallel agent-only models.

## After Roadmap 2

Roadmap 3 is now decomposed into named tasks with dependencies, non-goals, required evidence and exit criteria under [`roadmap-3/`](roadmap-3/).

It is deliberately **not active yet**. Before starting Roadmap 3 implementation:

1. reconcile the planned tasks against the final merged Roadmap 2 product;
2. confirm task dependencies/non-goals still match real gaps;
3. select and explicitly assign the first task(s), normally beginning with Product Depth;
4. update this file so Roadmap 3 becomes the active programme.

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

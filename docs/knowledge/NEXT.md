---
title: Sheetbase Current Work
status: canonical
last_reviewed: 2026-08-31
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

Roadmap 3 is active. Wave A (Product Depth) and the first Open Platform SDK
tasks are delivered through one stacked PR chain, `#97 → #98 → #99 → #100 →
#101 → #102`, reviewed bottom-up and merged in order:

```text
✓ NAV-01  — Canonical Navigation Model        (#98, completed 2026-08-30)
▶ GRID-01 — Keyboard & Selection Model        (#99, in review)
▶ NOTE-01 — Authoring Interaction Baseline    (#100, in review)
▶ SDK-01  — Contract Coverage & Parity        (#101, in review)
▶ SDK-02  — Scientific Developer Ergonomics   (#102, in review)
```

Wave A's foundation activation rides #97. Each task owns its complete
numbered-task exit criterion. SDK-02 builds dataframe/analysis helpers, bulk
transfer, version access and provenance ergonomics directly on SDK-01's
support matrix and does not start SDK-03 implicitly.

## Next tasks, in order

The next work queue, in recommended start order. The first three are
independent and may proceed in parallel once the stack above merges; each
must reconcile the current implementation before editing.

```text
1. NAV-02  — Context-Preserving Object Navigation
2. GRID-02 — Clipboard, Fill & Range Operations
3. NOTE-02 — Sections, Structure & Long-Document Navigation
4. FIND-01 — Recents & Work Resumption
5. SDK-03  — Lifecycle, Compatibility & Release Quality
```

Ordering rationale:

- **NAV-02** continues the completed NAV-01 foundation and is the depth task
  navigation quality depends on.
- **GRID-02** builds range operations on GRID-01's selection model.
- **NOTE-02** adds structure/outline on NOTE-01's authoring baseline.
- **FIND-01** becomes Ready after the stack merges (its NAV-01 prerequisite is
  then merged reality); it should start once navigation context from NAV-02
  is shaping the home/resume surfaces it feeds.
- **SDK-03** follows SDK-02 and is release/lifecycle work; do not start it
  implicitly while SDK-02 is in review.

Beyond this queue, Wave B (KNOW, VIEW, MODEL, REUSE, EVENT, EXT, ADMIN)
becomes Ready only through the gates in
[`roadmap-3/PROGRAMME_MAP.md`](roadmap-3/PROGRAMME_MAP.md). Roadmap order
alone does not assign work; promoting a Wave B task requires an explicit
update to this file.

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

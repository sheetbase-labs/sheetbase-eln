---
title: Sheetbase Current Work
status: canonical
last_reviewed: 2026-09-01
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
#101 → #102 → #104 → #105 → #106`, reviewed bottom-up and merged in order,
with sibling branches for later tasks riding the same stack (`#107 → #111`,
`#108 → #113`, `#110 → #112`, and `#109`):

```text
✓ NAV-01  — Canonical Navigation Model        (#98, completed 2026-08-30)
▶ GRID-01 — Keyboard & Selection Model        (#99, in review)
▶ NOTE-01 — Authoring Interaction Baseline    (#100, in review)
▶ SDK-01  — Contract Coverage & Parity        (#101, in review)
▶ SDK-02  — Scientific Developer Ergonomics   (#102, in review)
▶ NAV-02  — Context-Preserving Navigation     (#104, in review)
▶ GRID-02 — Clipboard, Fill & Range Ops       (#105, in review)
▶ NOTE-02 — Sections & Long-Document Nav      (#106, in review)
▶ SDK-03  — Lifecycle, Compatibility & Release Quality (#110, in review)
```

Wave A's foundation activation rides #97. Each task owns its complete
numbered-task exit criterion. SDK-02 builds dataframe/analysis helpers, bulk
transfer, version access and provenance ergonomics directly on SDK-01's
support matrix and does not start SDK-03 implicitly. SDK-03's lifecycle and
release work is implemented on #110 and merges only after the SDK stack
(#101, #102) is merged reality.

### Product Depth second pass

```text
▶ NAV-02  — Context-Preserving Object Navigation (#104, in review)
▶ GRID-02 — Clipboard, Fill & Range Operations   (#105, in review)
▶ NOTE-02 — Sections, Structure & Long-Document Navigation (#106, in review)
▶ FIND-01 — Recents & Work Resumption            (#107, in review)
▶ GRID-03 — Typed Editing & Validation UX        (#108, in review)
▶ NOTE-03 — Scientific Block Identity            (#109, in review)
▶ SDK-03  — Lifecycle, Compatibility & Release Quality (#110, in review)
▶ FIND-02 — Favourites & Saved Context           (#111, in review)
▶ NOTE-04 — Readiness Checklist & Evidence Preview (#112, in review)
▶ GRID-04 — Sort, Filter, Freeze & View Ergonomics (#113, in review)
```

## Next tasks, in order

The Wave A / second-pass tasks above are all in review on the stacked chain
and are merged bottom-up. The next net-new starts follow them:

1. **FIND-01 — Recents & Work Resumption** — in review (#107, with #111);
   it builds on the navigation-context model NAV-02 established.
2. **GRID-03 — Typed Editing & Validation UX** — in review (#108, with
   #113); it follows GRID-02's clipboard/fill bulk-write path with typed
   editors and inline validation recovery, without creating a second
   client-side rules engine.
3. **NOTE-03 — Scientific Block Composition** — in review (#109); improves
   how Sheets, figures, files and Records frame and expose provenance inside
   Notebooks, on top of NOTE-02's structural navigation.

Ordering rationale:

- The chain above merges in stack order; review findings land on the owning
  branch before merge.
- **FIND-01** depends only on merged Wave A navigation foundations; its
  recents surfaces build on the final navigation model.
- **GRID-03** follows GRID-02's bulk-write and validation-gate semantics.
- **NOTE-03** is the natural continuation now that long documents are
  navigable; it must keep canonical object identity and evidence semantics.
- **SDK-03** is implemented on #110 and waits for the SDK stack (#101,
  #102) to be merged reality before it can merge.

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

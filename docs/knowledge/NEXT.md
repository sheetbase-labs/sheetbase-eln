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

### Product Depth second pass

```text
✓ NAV-02  — Context-Preserving Object Navigation (#104, review-hardened)
▶ GRID-02 — Clipboard, Fill & Range Operations   (#105, review-hardened)
▶ NOTE-02 — Sections, Structure & Long-Document Navigation (#106)
```

### Third pass — resumption, typed entry, composition, release quality

Delivered in parallel on top of the second pass (independent file surfaces,
reviewed and review-hardened):

```text
▶ FIND-01 — Recents & Work Resumption               (#107)
▶ GRID-03 — Typed Editing & Validation UX           (#108)
▶ NOTE-03 — Scientific Block Composition            (#109)
▶ SDK-03  — Lifecycle, Compatibility & Release Quality (#110)
```

## Next tasks, in order

1. **FIND-02 — Favourites & Saved Context** — continues the FIND stream now
   that recents exist; favourites add deliberate pinning with user-scoped
   persistence and lifecycle-aware behaviour.
2. **GRID-04 — Sort, Filter, Freeze & View Ergonomics** — presentation/view
   state on the Sheet (multi-column sort/filter UX, frozen rows/columns,
   saved views) without mutating Dataset or analysis semantics.
3. **NOTE-04 — Review, Submission & Evidence Authoring UX** — pre-submission
   checks and evidence preview, completing the NOTE stream's
   working-Notebook → evidence transition.
4. **KNOW-01 — Knowledge Relationships** — Wave B head once the stack above
   merges: canonical relationships on the Roadmap 2 identity foundation
   (NAV-02 context model useful). VIEW-01, MODEL-01, EVENT-01 and EXT-01
   become eligible per the same gates in
   [`roadmap-3/PROGRAMME_MAP.md`](roadmap-3/PROGRAMME_MAP.md).
5. **SDK-03 → SDK releases**: once the SDK stack merges, the release
   workflow (#110) is the operational path; its first real run should
   accompany the first contract-version bump.

Ordering rationale:

- **FIND-02/GRID-04/NOTE-04** are the natural third-pass continuations of
  three streams that now carry solid foundations; each keeps its stream's
  invariants (FIND owns recents/favourites, GRID keeps one-write-target and
  presentation-vs-analysis separation, NOTE keeps evidence semantics).
- **KNOW-01** is the Wave B head: canonical relationships on the merged
  Roadmap 1/2 identity model. Wave B promotion is now explicit via this
  file per the Ready rule; ENT-ORG/GXP remain ADR-gated and OPS deferred.
- **SDK-03** is operationally complete on the stack; its first _release_
  waits for the SDK stack to be merged reality.

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

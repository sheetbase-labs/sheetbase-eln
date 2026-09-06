---
title: Sheetbase Current Work
status: canonical
last_reviewed: 2026-09-06
---

# Sheetbase — Current Work

This is the single current hand-off for Sheetbase development across roadmaps. Start here when deciding what work is active or next.

Do not infer current priority from historical roadmap task ordering, old hand-off text, open branches or unmerged PR descriptions.

## Current programme state

```text
Roadmap 1    COMPLETE
Roadmap 2    COMPLETE
Roadmap 3    ACTIVE — Waves A–C delivered as one stacked chain, in review
```

## Roadmap 2 closure

The final active Roadmap 2 tasks are complete:

```text
✓ AUTO-04 — Agent-authored Operations
✓ AUTO-05 — Agentic Scientific Workflows
```

AUTO-05 adds bounded digest-pinned multi-step workflows over AUTO-04 proposals.
Product contracts: [`docs/subsystems/agent-operations.md`](../subsystems/agent-operations.md) and
[`docs/subsystems/agent-workflows.md`](../subsystems/agent-workflows.md). Each operation retains
canonical permissions, provenance, and evidence. This closes Roadmap 2 without
adding the adaptive agent planning and autonomy assigned to Roadmap 3.

### Roadmap 2 deferral carried forward

**GOV-02 — Organisation Model** was not required to close Roadmap 2. Roadmap 3
revisits the need through ENT-ORG-01's adoption-gated ADR before any ownership
or RLS topology changes.

## Active Roadmap 3 work

Roadmap 3 Waves A (Product Depth remainder), B (Scientific Depth + Open
Platform) and C (Intelligent Workspace) are delivered as one linear stacked
PR chain, `#127 → … → #161`, each based on the previous head, reviewed
bottom-up and merged in order. Wave D is attempted as `#162` (proposed ADRs
plus explicit deferral) at the top of the same stack:

```text
Wave A remainder   #127 NAV-03 · #128 GRID-05 · #129 FIND-03
KNOW               #130 KNOW-01 · #131 KNOW-02 · #132 KNOW-03
VIEW               #133 VIEW-01 · #134 VIEW-02 · #135 VIEW-03 · #136 VIEW-04
MODEL              #137 MODEL-01 · #138 MODEL-02 · #139 MODEL-03 · #140 MODEL-04
REUSE              #141 REUSE-01 · #142 REUSE-02 · #143 REUSE-03
EVENT              #144 EVENT-01 · #145 EVENT-02 · #146 EVENT-03
EXT                #147 EXT-01 · #148 EXT-02 · #149 EXT-03
ADMIN              #150 ADMIN-01 · #151 ADMIN-02 · #152 ADMIN-03
AI                 #153 AI-01 · #154 AI-02 · #155 AI-03
ASSIST             #156 ASSIST-01 · #157 ASSIST-02 · #158 ASSIST-03
AUTO-PLUS          #159 AUTO-PLUS-01 · #160 AUTO-PLUS-02 · #161 AUTO-PLUS-03
Wave D             #162 organisation + regulated-control proposals, deferral
```

Earlier Wave A work (NAV-01/02, GRID-01..04, NOTE-01..04, FIND-01/02, SDK-01..03)
is merged reality on `main`. Each stacked task owns its complete numbered-task
exit criterion; supporting fixes found during verification ride with their task
PR (notably the `in.(eq.…)` lineage filter fix in #131 and the admin gate fix
in #149).

## Next tasks, in order

1. Review the stack bottom-up (`#127` first) and merge in order. Do not
   reorder: every branch is based on the previous PR's head.
2. Decide ADR-0044 (organisation domain) and ADR-0045 (regulated control
   model): accept, amend, or leave proposed. Acceptance gates ENT-ORG-02 and
   GXP-02..04 respectively, each additionally requiring its concrete adoption
   need.
3. Promote Wave B/C follow-ups only through explicit assignment here;
   roadmap order alone does not assign work.

### Programme scope decisions

- ENT-ORG-02/03 deferred: no production users, therefore no multi-workspace
  adoption need. Implementation begins only with an accepted ADR-0044 plus a
  concrete deployment need.
- GXP-02..04 deferred: no concrete regulated intended use. Building further
  controls without one would be compliance theatre.
- OPS-01..03 deferred. Do not start without a later explicit programme
  decision based on institutional scale/adoption evidence.

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

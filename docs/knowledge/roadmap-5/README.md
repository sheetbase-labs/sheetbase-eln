---
title: Roadmap 5 — app-3 interface closure
status: proposed
last_reviewed: 2026-10-11
---

# Roadmap 5 — app-3 interface closure

**Implemented, not yet accepted.** All 22 tasks are implemented — the 21 from the audit plus R5-CONFIG-06, found while reviewing the running product on
`GWP/roadmap-5-implementation` (PR #222), one commit per task, integrated in
waves from separate worktrees. See the
[programme map](PROGRAMME_MAP.md#delivery-record) for the commit list and the
verification record. Implementation is not acceptance: the success criteria
below are not yet recorded as met, the visual-parity and browser layers remain
deferred, and this corpus still does not certify Roadmap 4 acceptance or claim
deployment or release readiness.

Source survey, 11 October 2026:

| Side             | Reference                                                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface source | `/Users/garethprice/Developer/sheetbase/sheetbase-app-ui-only` — a working copy of the app-3 UI-only build. **It is not a git checkout** (no `.git`), so this evidence is by file path in an unversioned tree of unknown revision. |
| ELN              | `main` at `10a84a42` (merge of PR #220, the Roadmap 4 programme).                                                                                                                                                                  |
| Findings         | [FINDINGS.md](FINDINGS.md) — the per-screen audit with evidence on both sides.                                                                                                                                                     |

## Why this programme

The ELN already has the app-3 shell kit, all of its design primitives and its
colour tokens. What differs is not structure but depth: a list of ~50 concrete
places where a screen the design build demonstrates is thinner, unaddressable or
absent in the product. Most of them are cheap because the data already exists —
`dataset_imports` is written and indexed with no reader anywhere, the
`ObjectHistoryTimeline` component exists but is mounted only for sheets, and the
`NotFound` screen is ported but wired to nothing.

The programme therefore has one shape: **make the adopted interface as complete
as the design it was adopted from, without inventing new architecture.**

## What to do first

1. **R5-SURF-01 / R5-SURF-02** — surface data the ELN already holds (dataset
   Imports / Used by / History; project-scoped Datasets, Samples, Experiments).
2. **R5-SURF-03** — mount the ported `NotFound` (minutes, user-visible).
3. **R5-SHELL-03** — give the capability registry real keys so genuinely
   unbuilt capabilities can say so honestly.
4. Then the studio and notebook depth, which are the only items needing new
   capability rather than new surfaces.

## Programme

Six streams, 22 proposed tasks, all **PROPOSED**. Stream files are the complete
specifications; [PROGRAMME_MAP.md](PROGRAMME_MAP.md) is the only status table.

| Stream                                        | Tasks | User outcome                                                                                                                                       | Priority |
| --------------------------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| [Reach what we hold](tasks/SURF.md)           |     4 | A record's imports, usage and history are visible where the design puts them; a project's own lists exist; an unknown URL lands somewhere designed | First    |
| [Analysis studio depth](tasks/STUDIO.md)      |     3 | Analysis states its method and its inputs; charts are authored by drag-and-drop; a stale source is resolvable                                      | Core     |
| [Notebook and review fidelity](tasks/NOTE.md) |     2 | Review reads like the annotated document; the notebook carries signature and action blocks                                                         | Core     |
| [Home](tasks/HOME.md)                         |     1 | A quiet workspace says what is next instead of showing empty panels                                                                                | Second   |
| [Configuration depth](tasks/CONFIG.md)        |     6 | Diagnostics, usage, instruments, models, templates and milestones carry the evidence the design shows                                              | Second   |
| [Shell, search and platform](tasks/SHELL.md)  |     6 | Every route gets the same shell and theme; search and sign-in carry their designed states                                                          | Second   |

## Success criteria

- Every row in [FINDINGS.md](FINDINGS.md) is either implemented, or explicitly
  reclassified as a deliberate difference with the reason recorded there.
- A URL that matches nothing renders the product's own not-found screen, not the
  router's default.
- No screen shows fixture data to fill a gap: an unbuilt capability states that
  it is unbuilt, from the deployment's capability flags.
- The app-3 screen inventory can be walked route by route with a corresponding
  ELN surface at the same URL shape, or a recorded reason it differs.
- Every delivered task names the Roadmap 4 task or decision that owns the
  underlying behaviour, so completion is not claimed twice.

## Boundaries

- The adopted v3 interface (`src/components/v3/`) and the accepted decisions are
  authoritative. This programme does not re-open ADR-0048 (shared grid and
  formula authority) or ADR-0051 (workspace-defined Record Models).
- PostgreSQL and RLS stay the permission and state authority; browser data keeps
  using the same-origin `/api/db` boundary and canonical mutation RPCs.
- No new UI kit, no second state container, no fixture-backed screen, no
  wholesale re-port of app-3.
- Visual work follows the repository's product-design guidance and Impeccable,
  and is verified on real renders, not on the source alone.
- The `?state=` query affordances the design build uses for its own QA are
  **not** a product requirement; [FINDINGS.md](FINDINGS.md) records that
  difference with its reasoning.

## Relationship to other programmes

- **Roadmap 4** owns the interface adoption and the tasks that produced this
  port. Where a Roadmap 4 task or accepted decision already owns a requirement,
  this programme links it instead of restating the exit.
- **[Complete scientific workflows](../../../plans/roadmap-5/README.md)** is a
  separate, unnumbered proposal about scientific depth (bench capture, large
  imports, full-data analysis, recovery). It is not this corpus and does not own
  the Roadmap 5 number. If both proceed, they should be reconciled into one
  programme before implementation claims overlap.
- **Roadmap 5** as of this document means _this_ corpus:
  `docs/knowledge/roadmap-5/`.

## How to use this corpus

Read [FINDINGS.md](FINDINGS.md) for the evidence, [PROGRAMME_MAP.md](PROGRAMME_MAP.md)
for status and sequencing, [GUIDE.md](GUIDE.md) for execution and acceptance
rules, then the stream specification for the task in hand. Every task is
implemented on the branch named at the top of this file; nothing here is an
assignment.

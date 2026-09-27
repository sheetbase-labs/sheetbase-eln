---
title: Sheetbase Roadmap 4
status: proposed
last_reviewed: 2026-09-27
---

# Roadmap 4 — Design-led Product

> **Make Sheetbase look and work exactly like UI system v3: every screen,
> every state, every capability.**

**Status: proposal only.** Nothing here is assigned or activated; current
priority remains defined by [`../NEXT.md`](../NEXT.md). This is the Roadmap 4
proposal that earlier status documents refer to; it had been discussed but not
written up before 27 September 2026.

## Why

A complete design for Sheetbase now exists: 126 screens and a design system,
vendored at [`../design/ui-system-v3/`](../design/ui-system-v3/README.md) and
renderable with `pnpm design:render`. Comparing it with `main` at `9538f36`
shows that much of the data model it needs is already implemented (records,
revisions, datasets and versions, sheets, templates, reviews, signatures,
pipelines, webhooks, samples, bookings), while the interface, information
architecture and a substantial set of capabilities differ. Roadmap 4 closes
all of it.

## Definition of done

- Every design screen passes an automated visual comparison with its design
  render, in light and dark, on a seed that reproduces the design's data.
- Every control, flow and state on those screens works, enforced on the server.
- The ELN's grids, charts and filter builder run on `sheetbase-components`,
  themed to v3 at source; Handsontable and Recharts are gone.
- Superseded interface code is deleted.

## Start here

1. [`DESIGN_ADOPTION.md`](DESIGN_ADOPTION.md) — how the design gets into the
   code and replaces the current UI: token map, component packages, route map,
   verification.
2. [`tasks/DEC.md`](tasks/DEC.md) — the decisions taken first, including
   proposed [ADR-0047](../decisions/0047-ui-system-v3-adoption.md) and
   [ADR-0048](../decisions/0048-sheet-grid-on-sheetbase-table.md).
3. [`PROGRAMME_MAP.md`](PROGRAMME_MAP.md) — dependencies, waves and delivery
   rules.
4. [`tasks/README.md`](tasks/README.md) — 86 tasks in 17 streams.
5. The design reference: render a screen, open its `.dc.html` for structure
   and its `screen-text/*.txt` for copy.

## Programmes

| Programme                | Streams                    | Tasks | What it delivers                                                                                          |
| ------------------------ | -------------------------- | ----: | --------------------------------------------------------------------------------------------------------- |
| Decisions and foundation | DEC, DSYS, SHELL, COMP     |    30 | Decisions; tokens, components, shell; `sheetbase-components` themed and integrated; seed and parity suite |
| Daily work               | WORK, PROJ, EXP, SRCH, MOB |    18 | Home, Inbox, Schedule, notifications, projects, experiments, notebooks, offline, search, phone            |
| Scientific data          | DSET, SHEET, MDL           |    15 | Value flags, snapshots, import and parsers, working sheets, promotion, analysis, models                   |
| Lab operations           | LAB                        |     7 | Withdrawals, hold times, release, materials, labels and scanning, instruments, protocols                  |
| Automation & platform    | PIPE, SET                  |     9 | Pipeline screens, people in the loop, proposals, settings, integrations and API                           |
| Governed evidence        | REV, PORTAL                |     7 | Review rounds, signing with re-authentication, evidence versus live, audit chain, client portal           |

## Boundaries

- **Merged is not accepted.** The distinctions in [`../ROADMAP.md`](../ROADMAP.md)
  (implemented, verified, deployed) apply to every task here.
- **Decisions are part of the work.** Regulated signing, tamper-evident audit,
  client users, groups, workspace-defined models, pausing pipelines and offline
  edits each need an ADR. Roadmap 4 schedules those decisions first (DEC) and
  then builds the capability; a pending decision is never a reason to ship a
  screen without it.
- **No second engines or models.** Pipelines, templates, snapshots, reviews and
  signatures extend the implemented contracts; the task files name them.
- **No parallel UI.** Each migrated route deletes what it replaces.
- **Sample data is seeded, not hard-coded.** The design's scenario is created
  through the real data layer so the app and the design can be compared on the
  same content.

## Relationship to earlier roadmaps

- Builds on NAV, GRID, NOTE, FIND, KNOW, VIEW, MODEL, REUSE and ADMIN
  (Roadmap 3) and the pipeline extension in ADR-0046.
- Takes GXP-01 (ADR-0045) and the relevant parts of ENT-ORG (ADR-0044) to a
  decision in DEC-04..06 because the design depends on them.
- The outstanding verification items in [`../NEXT.md`](../NEXT.md) (REUSE-02
  CI failure, whole-workflow acceptance) should be resolved before or alongside
  wave A, since Roadmap 4 rebuilds the screens those workflows run through.

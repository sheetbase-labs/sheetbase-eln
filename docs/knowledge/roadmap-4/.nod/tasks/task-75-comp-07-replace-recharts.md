---
id: task-75
title: COMP-07 — Replace Recharts
type: task
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-03"
parent: epic-42
related:
  - task-2
  - task-55
  - task-65
tags:
  - COMP-07
  - COMP
  - wave-B
---

# COMP-07 — Replace Recharts

Spec: [COMP-07 in tasks/COMP.md](../../tasks/COMP.md#comp-07--replace-recharts)

- Stream: COMP (epic-42)
- Wave: B
- Waits on: DEC-01 (task-2), COMP-03 (task-55), COMP-05 (task-65)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): not-started. Evidence: src/components/viz/chart-plots.tsx:9 — Recharts import; src/components/viz/chart-renderer.tsx:17 — Recharts import; package.json:131 — recharts dependency. Remaining: All four steps remain: canonical spec adapter, package renderer, identical export/frozen figure proof, Recharts removal. Blocked by COMP-03/05. See docs/knowledge/roadmap-4/RECONCILIATION.md#comp-07. Source audit, not fresh service/browser acceptance.
- 2026-10-02: 2026-10-02 dependency reconciliation: added existing specification/programme-map gates COMP-03, COMP-05. Other partial implementation can continue; these are full-task acceptance dependencies.
- 2026-10-03: COMP-07.1/.2/.4 done (a58a8492): recharts removed, point/line figures render through the package FigureSvg, analysis SVG export uses the package serialiser, bar/histogram native SVG, 3457 unit tests + build pass. Exit not yet met: bar, grouped/stacked bar, summary, histogram, box, violin and heatmap are not rendered by the package because FigureModel has no bar/box/heatmap primitive — they stay on ELN renderers. 07.3 partially done: PNG rasterisation still uses the ELN rasteriser over the package SVG. Needs package primitives (or a recorded exit change).
- 2026-10-03: Histogram bin and violin density primitives added to the package at 0.4.0 (117 explorer tests). ELN cutover pending: chart-package.ts mapping + deleting the ELN histogram/violin fallback renderers, then COMP-07 exit is met.
- 2026-10-03: COMP-07 complete: all thirteen chart types in chart-spec.ts render through chart-package.ts -> FigureSvg (histogram via the 0.4.0 bin primitive, violin via the 0.4.0 density primitive); chart-plots.tsx deleted; recharts absent. Remaining package limits recorded, not faked: violin outlier points, per-series colours/palette, numeric tick formatting and axis reversal are not expressible in the v3 figure.

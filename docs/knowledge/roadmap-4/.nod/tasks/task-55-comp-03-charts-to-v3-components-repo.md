---
id: task-55
title: COMP-03 — Charts to v3 (components repo)
type: task
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-03"
parent: epic-42
related:
  - task-2
  - task-43
tags:
  - COMP-03
  - COMP
  - wave-A
---

# COMP-03 — Charts to v3 (components repo)

Spec: [COMP-03 in tasks/COMP.md](../../tasks/COMP.md#comp-03--charts-to-v3-components-repo)

- Stream: COMP (epic-42)
- Wave: A
- Waits on: DEC-01 (task-2), COMP-01 (task-43)
- Steps: 5 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: ../sheetbase-components/packages/explorer/src/index.ts:29-31 — buildChart/export functions exposed, no standalone Chart component; ../sheetbase-components/packages/explorer/src/lib/chart.ts:445 — chart builder exists; ../sheetbase-components/packages/explorer/src/explorer-v3.css:1 — styling groundwork; ../sheetbase-components/packages/shared/src/index.ts:9 — theme icons, no shared v3 icon set. Remaining: 1 standalone Chart export absent. 2 verify/implement v3 marker, excluded-point and reference-line contract. 3 shared-axis multichart contract missing. 4 design-role panel needs implementation/acceptance. 5 shared v3 icon source not established. No visual fixture acceptance recorded by this audit. See docs/knowledge/roadmap-4/RECONCILIATION.md#comp-03. Source audit, not fresh service/browser acceptance.
- 2026-10-02: 2026-10-02 dependency reconciliation: added existing specification/programme-map gates COMP-01. Other partial implementation can continue; these are full-task acceptance dependencies.
- 2026-10-03: COMP-03.1-03.5 done (components f56f606). Exit still needs a fixture comparison against the Analysis/Notebook design renders.
- 2026-10-03: All steps done; closed by roadmap sync.
- 2026-10-03: Reopened: the exit requires the design's step-yield and turbidity charts to render identically in the components repo. Code steps done (f56f606) but the fixture/crop comparison against tests/visual/design-reference/Analysis-*.png is not yet in place.
- 2026-10-03: COMP-03 turbidity fixture: geometry is pixel-identical but the chart differs 3.2%/3.1% because the Analysis canvas sizes text/markers/strokes for its 0.758 display scale (font 15/14 units, r5/10px markers, stroke 1.8) while the figure draws canonical metrics (11 units, r4/8, 1.6) with no size override. Attribution: text scale ~0.81pp, font family ~0.72pp, marker/stroke ~0.50pp. Needs a per-figure metric override in the package (or a recorded exit change) before the turbidity chart can pass.
- 2026-10-03: COMP-03 complete: step-yield (0.44%/0.38%) and turbidity (1.60%/1.49%) charts now match their design crops in both themes in the components repo, using ChartSpec.metrics to express the Analysis screen's larger text/marker/stroke sizes.

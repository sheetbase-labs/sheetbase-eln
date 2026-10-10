---
id: task-61
title: COMP-04 — Filter builder to v3 (components repo)
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
  - COMP-04
  - COMP
  - wave-A
---

# COMP-04 — Filter builder to v3 (components repo)

Spec: [COMP-04 in tasks/COMP.md](../../tasks/COMP.md#comp-04--filter-builder-to-v3-components-repo)

- Stream: COMP (epic-42)
- Wave: A
- Waits on: DEC-01 (task-2), COMP-01 (task-43)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: ../sheetbase-components/packages/advanced-search/src/index.ts:8-9 — FilterChips exported; ../sheetbase-components/packages/advanced-search/src/FilterChips.tsx:11-20,40-53 — named labels/removal/add callback; ../sheetbase-components/packages/advanced-search/src/FilterChips.test.tsx:1 — test exists. Remaining: 1 FilterBuilder popover export absent. 2 chips implementation supports existing done flag, runtime tests not rerun. 3 States crop fixture/parity outstanding. See docs/knowledge/roadmap-4/RECONCILIATION.md#comp-04. Source audit, not fresh service/browser acceptance.
- 2026-10-02: 2026-10-02 dependency reconciliation: added existing specification/programme-map gates COMP-01. Other partial implementation can continue; these are full-task acceptance dependencies.
- 2026-10-03: COMP-04.1 done (components fa5d2df). 04.3 fixture vs States render remains; crop box on States-light.png x=557 y=1091 w=360 h=117 (spec says 12px padding, render measures 8px).
- 2026-10-03: COMP-04.1 done; 04.2 verified. 04.3 fixture exists (packages/advanced-search/e2e/v3-filter.spec.ts, crop States y=1087 h=126) but is an annotated expected-failure at ~7-9% pixel difference; cause not yet diagnosed.
- 2026-10-03: COMP-04 complete: FilterBuilder popover (fa5d2df) and the States fixture now matches the design crop at 0.000% in light and dark (2b4d279, test.fail removed). Components 20 tests + lint/typecheck clean.
- 2026-10-03: All steps done; closed by roadmap sync.

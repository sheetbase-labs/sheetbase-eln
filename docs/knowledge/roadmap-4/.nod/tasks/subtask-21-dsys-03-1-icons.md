---
id: subtask-21
title: DSYS-03.1 — Icons
type: subtask
status: todo
priority: high
created: "2026-09-27"
updated: "2026-09-27"
parent: task-20
tags:
  - DSYS-03.1
  - DSYS
---

# DSYS-03.1 — Icons

Step 1 of 7 in [DSYS-03](../../tasks/DSYS.md#dsys-03--primitives-restyled-in-place); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: partially implemented across four passes (delegated, verified by the coordinator); stays open. Folders converted so far: audit, collaboration, shell, viz, comments, scientific, stories. Each Lucide usage is either replaced with the v3 Icon where the set has the same concept or kept with the reason recorded - there is no dashed circle, circled check or cross, trash, save, expand, panel, hamburger, star, spinner, sort arrow, rich-text mark, alignment mark or layout-grid glyph in the 50-icon v3 set, and the per-type chart glyphs stay distinct because the chart-type picker needs them to differ. Contract changes: AppShellNavItem.icon and RecordLink.icon are IconName rather than LucideIcon. Remaining: the other folders that still import Lucide (components/notebook, components/sheet, components/v3, routes and a few singles).
- 2026-09-27: Icon component, 49-path name union, test and story landed; Lucide replacement proceeds folder by folder.

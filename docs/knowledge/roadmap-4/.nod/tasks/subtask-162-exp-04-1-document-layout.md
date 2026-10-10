---
id: subtask-162
title: EXP-04.1 — Document layout
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-161
tags:
  - EXP-04.1
  - EXP
---

# EXP-04.1 — Document layout

Step 1 of 6 in [EXP-04](../../tasks/EXP.md#exp-04--notebook-working-surface); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: completed. The measure half (prose in a 680px column, sheets/charts full width, exposed as blockMeasure and data-block-measure) landed earlier; the banner half is now in: a notebook pinned to a template version with a newer published version shows the design's banner naming the pinned and newer versions with a Review action linking to the update view. It applies nothing, appears only when there is genuinely something newer (a newer draft does not count), and is hidden in historical-evidence and archived views where the affordance would dangle. Three tests assert the banner, its absence, and that no apply or write is made.
  - 2026-10-10: the measure half is implemented and tested: prose blocks render in a 680px column while sheets, charts and plate maps take the full width, exposed as blockMeasure() and data-block-measure, with a component test in notebook-document.test.tsx (48 cases in the file). Still open: the template-version banner, whose data source is the existing preview_notebook_template_upgrade / apply_notebook_template_upgrade pair, and which SHEET-04.4 also covers.

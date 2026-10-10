---
id: subtask-162
title: EXP-04.1 — Document layout
type: subtask
status: todo
priority: high
created: "2026-09-27"
updated: "2026-09-27"
parent: task-161
tags:
  - EXP-04.1
  - EXP
---

# EXP-04.1 — Document layout

Step 1 of 6 in [EXP-04](../../tasks/EXP.md#exp-04--notebook-working-surface); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: the measure half is implemented and tested: prose blocks render in a 680px column while sheets, charts and plate maps take the full width, exposed as blockMeasure() and data-block-measure, with a component test in notebook-document.test.tsx (48 cases in the file). Still open: the template-version banner, whose data source is the existing preview_notebook_template_upgrade / apply_notebook_template_upgrade pair, and which SHEET-04.4 also covers.

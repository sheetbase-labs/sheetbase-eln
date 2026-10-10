---
id: subtask-164
title: EXP-04.3 — Insert-block menu per design (/ and +, filterable, keyboard)
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-161
tags:
  - EXP-04.3
  - EXP
---

# EXP-04.3 — Insert-block menu per design (/ and +, filterable, keyboard)

Step 3 of 6 in [EXP-04](../../tasks/EXP.md#exp-04--notebook-working-surface); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (delegated, then verified by the coordinator). The block catalogue now carries the canvas's labels and descriptions verbatim and the design's order, and both surfaces (/ and the + control) present the same 'Insert block' menu with its chrome (title, arrow/Enter/Esc hints, filtering, highlighted row). The slash-command menu's unit test became a .tsx so the menu can be rendered, and three tests were added to the notebook document covering / opening and filtering the menu, Esc closing it, arrow+Enter inserting, and + opening the same menu. One deviation is recorded by the implementer: Chart sits in 'Files and figures' rather than beside Sheet, because moving it would make that group's name wrong; the canvas menu is a flat seven-entry mock. 60 tests pass across the two files.

---
id: subtask-140
title: PROJ-04.1 — Placement model
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-139
tags:
  - PROJ-04.1
  - PROJ
---

# PROJ-04.1 — Placement model

Step 1 of 4 in [PROJ-04](../../tasks/PROJ.md#proj-04--folders-and-files); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: placement model landed (drizzle/0374, 0375; tests/db/folder-placement.test.ts, 4 cases). Decision recorded: records keep records.folder_id for existing readers and the folder tree; sheets, datasets, analyses and pipelines are placed in api.folder_items, one folder per object. api.move_to_folder refuses a cross-project home for an object that has a project (SB119), an unknown object, another workspace and a non-writer, and api.folder_items_list reads a folder's contents. Remaining on this step: the Folders tab UI.

---
id: subtask-109
title: WORK-01.4 — Later kinds
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-105
tags:
  - WORK-01.4
  - WORK
---

# WORK-01.4 — Later kinds

Step 4 of 5 in [WORK-01](../../tasks/WORK.md#work-01--work-items); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: completed. All five later kinds are now in api.my_work_items: signature requests (witness_requested), data issues (data_issue), runs waiting (run_waiting, added by PIPE-02), approvals (approval_requested) and conflicts (cell_conflict, added with EXP-05.4), alongside review_requested, run_failed, material_expiring and following. Step 5's data module is in place too: src/lib/work-items/data.ts holds the query keys, countByKind (a complete per-kind record, which is what caught two omissions when kinds were added), and groupWorkItems with today / next 7 days / later and the following bucket; the list is invalidated by change events in src/lib/live-events.ts, which invalidates ['work-items'] on the relevant events. Kinds are derived rather than stored wherever there is a source of truth, so completing the underlying action removes the item without a dismiss - verified per kind in the DB tests for each (pipeline-waiting, sheet-cell-conflicts, client-portal, review).
  - 2026-10-10: four of the five later kinds are now in api.my_work_items. Signature requests (witness_requested), data issues (data_issue) and approvals (approval_requested) were already present; runs waiting (run_waiting) is added by drizzle/0397, derived from a waiting run whose prompt names me and is unanswered, so answering it or letting it expire removes the item without a dismiss. src/lib/work-items/data.ts gains the kind and the inbox maps it to the Runs tab with a Waiting label and a warn tone, linking to /pipelines. Verified by tests/db/pipeline-waiting.test.ts (4 cases: appears for the person asked, absent for somebody not asked, gone once answered). Still open: conflicts (EXP-05), which is not started and has no conflict model to derive from.

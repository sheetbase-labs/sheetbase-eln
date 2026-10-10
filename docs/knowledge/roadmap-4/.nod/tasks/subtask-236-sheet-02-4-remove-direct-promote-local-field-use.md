---
id: subtask-236
title: SHEET-02.4 — Remove direct promote_local_field use from the UI
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-232
tags:
  - SHEET-02.4
  - SHEET
---

# SHEET-02.4 — Remove direct promote_local_field use from the UI

Step 4 of 4 in [SHEET-02](../../tasks/SHEET.md#sheet-02--promote-local-columns); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: completed, on the 'keep the RPC' branch. Nothing in the UI called promote_local_field any more - the promote dialog asks through request_column_promotion, the approval decides, and api.apply_column_promotion settles it - so the two client wrappers that called the direct path (promoteLocalField and previewLocalFieldPromotion) were dead code with only their own test as a caller, and they are removed rather than kept as a second way to promote a column; the test that exercised them now covers the request path. The RPC itself is deliberately retained, and the reason is recorded where the wrappers were: the request flow records a model_field promotion but cannot yet apply one, because api.apply_column_promotion refuses any target that is not a dataset schema, so retiring the RPC now would remove the only working path for that target. It retires with the model-field apply, not before it. preview_local_field_promotion is not dead - request_column_promotion calls it server-side. Verified: typecheck clean and the evolution client test passes.

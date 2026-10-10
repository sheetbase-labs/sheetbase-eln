---
id: subtask-241
title: SHEET-04.1 — Fix REUSE-02 with a regression test
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-240
tags:
  - SHEET-04.1
  - SHEET
---

# SHEET-04.1 — Fix REUSE-02 with a regression test

Step 1 of 4 in [SHEET-04](../../tasks/SHEET.md#sheet-04--templates); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: resolved as acceptance rather than a fix (delegated, then verified by the coordinator). The component that failed in the September baseline was retired in 9ced9f6d, so the failure is dated and not reproducible; NEXT.md asks instead for equivalent default-value and template-update acceptance. Two DB tests were added to tests/db/notebook-template-instantiate.test.ts: a Template Version's declared parameter default reaches the instantiated Sheet Instance through the canonical caller boundary (src/lib/parameter-input.ts, which is what the retired dialog used), and publishing v2 leaves a notebook pinned to v1 while an applied update adds the new block and preserves the existing Sheet Instance's identity and entire state. Both were proved to fail when the behaviour was temporarily broken, and the break was reverted. No production code changed and no defect found: the RPC deliberately does not apply template defaults itself, and changing that would be a new contract needing a migration. 14 tests pass in the file.

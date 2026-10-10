---
id: subtask-244
title: SHEET-04.4 — Per-notebook update view (TemplateUpdate) on the existing upgrade APIs
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-240
tags:
  - SHEET-04.4
  - SHEET
---

# SHEET-04.4 — Per-notebook update view (TemplateUpdate) on the existing upgrade APIs

Step 4 of 4 in [SHEET-04](../../tasks/SHEET.md#sheet-04--templates); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (delegated, then verified by the coordinator). The per-notebook update view previously rendered conflicts only as a count and hardcoded outcome 'keep'. It now shows each conflict with the outcomes the RPC accepts, including nested sheet-definition decisions (retain-local / map / defer with a target candidate), seeds a complete decision set from the server's allowed outcomes, builds the payload with the existing buildNotebookTemplateUpgradeDecisions, and surfaces a rejected apply as an error Notice rather than success. Apply is recorded as a template update by the existing RPC. Three component tests cover the automatic changes, both conflict kinds, the exact decision payload for a nested retarget, and the rejected-apply path. Not exercised: the live RPC round-trip against Postgres, and the notebook banner (EXP-04.1).

---
id: subtask-303
title: LAB-07.5 — Deviation recording when linked protocol text is edited in a notebook
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-09"
parent: task-298
tags:
  - LAB-07.5
  - LAB
---

# LAB-07.5 — Deviation recording when linked protocol text is edited in a notebook

Step 5 of 6 in [LAB-07](../../tasks/LAB.md#lab-07--controlled-protocols); the full step text is under “Steps” there.

## Work Log
  - 2026-10-09: verified and marked done. drizzle/0352/0353/0356 and tests/db/protocol-deviations.test.ts (3 cases) record a deviation when a pinned step's text changes, ignore progress edits, and carry frozen/recorded text into the audit event; src/components/audit/experiment-history.test.tsx proves the History row renders it. Remaining at task level: the review surface and the screen exits.
  - 2026-10-09: History surfacing proved (drizzle/0356; src/components/audit/experiment-history.test.tsx). The deviation event follows the audit `changes` convention, so the History row renders the frozen and recorded protocol step text; the DB test asserts that payload. Remaining: the review surface and the original screen exits.
  - 2026-10-09: server contract + DB tests landed (drizzle/0352, 0353; tests/db/protocol-deviations.test.ts, 3 cases).
    api.validate_scientific_block no longer refuses a copied step's text change; internal.protocol_step_deviation
    records frozen/recorded text, the pinned revision and the experiment's exact protocol_version_id, and emits a
    protocol_deviation change event. Progress edits (completed/note) are not deviations. Remaining: the History and
    review surfaces must render protocol_deviations, plus the original screen exits.

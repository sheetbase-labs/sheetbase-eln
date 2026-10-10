---
id: subtask-300
title: LAB-07.2 — Structured sections
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-09"
parent: task-298
tags:
  - LAB-07.2
  - LAB
---

# LAB-07.2 — Structured sections

Step 2 of 6 in [LAB-07](../../tasks/LAB.md#lab-07--controlled-protocols); the full step text is under “Steps” there.

## Work Log
  - 2026-10-09: verified and marked done. Structured content is carried by canonical blocks: procedure_step with immutable step identity and provenance (drizzle/0024, tests/db/protocol-material-blocks.test.ts) and units/tolerance preserved in rendering (src/components/v3/protocols/protocol-document.test.tsx). Step identities feed EXP-02/EXP-03 through payload.sourceStepBlockId.

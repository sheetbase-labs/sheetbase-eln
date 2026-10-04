---
id: subtask-258
title: MDL-02.2 — Rules
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-03"
parent: task-256
tags:
  - MDL-02.2
  - MDL
---

# MDL-02.2 — Rules

Step 2 of 4 in [MDL-02](../../tasks/MDL.md#mdl-02--model-editor); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: api.model_rules (workspace-owned, condition DSL, effect flag_block_submit|warn|block, RLS schema.edit + api_client read) evaluated by one internal.evaluate_model_rules wired into guard_model_custom_fields (block refuses, warn non-blocking/reported) and submit_record_revision (flag_block_submit blocks submit), plus model_record_validation and create/update/remove/list RPCs. Evidence: migration 0289 (applied to dev DB), tests/db/model-rules.test.ts (7), full pnpm test:db 153/1248, pnpm test 3382, interactions/areas/screens green, db:generate clean. Commit 30d165cb.

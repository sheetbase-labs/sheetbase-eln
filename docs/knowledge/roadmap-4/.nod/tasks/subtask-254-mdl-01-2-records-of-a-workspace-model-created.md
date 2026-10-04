---
id: subtask-254
title: MDL-01.2 — Records of a workspace model created through create_model_record with field…
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-03"
parent: task-252
tags:
  - MDL-01.2
  - MDL
---

# MDL-01.2 — Records of a workspace model created through create_model_record with field…

Step 2 of 3 in [MDL-01](../../tasks/MDL.md#mdl-01--workspace-defined-record-models); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: Workspace model records: chk_records_kind replaced by internal.guard_record_kind (built-in model_kinds key OR record_models key owned by the workspace), record_field_definitions FK relaxed with the same guard, internal.model_key_for resolves workspace keys so guard_model_custom_fields validates fields, and create_model_record uses next_record_model_identifier for workspace models. Records stay searchable/linkable/audited. Evidence: migration 0287 (applied to dev DB), tests/db/record-model-records.test.ts (8), full pnpm test:db 152/1241, pnpm test, interactions/areas/screens green, db:generate clean. Commit next. REMAINING: field-authoring RPCs for workspace models are MDL-02; lifecycle gating MDL-03; public API/SDK MDL-01.3.

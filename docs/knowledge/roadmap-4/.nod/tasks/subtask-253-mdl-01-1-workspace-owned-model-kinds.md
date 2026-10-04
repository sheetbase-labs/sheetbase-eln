---
id: subtask-253
title: MDL-01.1 — Workspace-owned model kinds
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-03"
parent: task-252
tags:
  - MDL-01.1
  - MDL
---

# MDL-01.1 — Workspace-owned model kinds

Step 1 of 3 in [MDL-01](../../tasks/MDL.md#mdl-01--workspace-defined-record-models); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: api.record_models (workspace, key, name, description, identifier_prefix, lifecycle, current_version) with unique key/prefix per workspace and RLS gated to schema.edit; built-in model_kinds not duplicated (a workspace model cannot shadow one). create_workspace_model + next_record_model_identifier reuse internal.id_sequences per prefix (atomic, workspace-scoped). Evidence: migration 0286 (applied to dev DB), tests/db/record-models.test.ts (8), full pnpm test:db 151/1233, pnpm test, interactions/areas/screens green, db:generate clean. Commit d9ac08bf.

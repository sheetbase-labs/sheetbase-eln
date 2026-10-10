---
id: subtask-259
title: MDL-02.3 — Field editor with reason-for-change, impact
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-256
tags:
  - MDL-02.3
  - MDL
---

# MDL-02.3 — Field editor with reason-for-change, impact

Step 3 of 4 in [MDL-02](../../tasks/MDL.md#mdl-02--model-editor); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (editor delegated, the migration RPC by the coordinator). Editing a model field's definition now requires a reason for change, shows the impact before applying (records on each version, templates, sheets) and the choice between new records only and also migrating open experiments, applies through the existing evolution RPC, and locks a key that is already published with an explanation. The coordinator then closed the gap the implementer flagged: the choice was recorded but nothing carried it out, so api.migrate_open_experiments_to_model_version (drizzle/0403) is the batch it promises. It defines 'open' explicitly - not archived, not deleted, not approved, because an approved experiment's evidence is frozen - upgrades every record through the canonical per-record RPC so each migration is attributed, audited in record_model_version_upgrades and emits its own change event, and is all-or-nothing so a refusal rolls the batch back. The UI runs it only after the definition edit succeeds. Still open: precision (decimal places) is not implemented because the field contract has no such property anywhere in the repo; adding one is a schema decision, not an implementation detail.

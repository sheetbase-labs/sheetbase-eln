---
id: subtask-331
title: SET-01.2 — ID prefixes and next numbers per kind in workspace_settings
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-09-28"
parent: task-329
tags:
  - SET-01.2
  - SET
---

# SET-01.2 — ID prefixes and next numbers per kind in workspace_settings

Step 2 of 3 in [SET-01](../../tasks/SET.md#set-01--workspace-general-settings); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: workspace_settings.id_prefixes + durable internal.id_sequences and api.next_record_identifier (per-kind prefix, never-reused number; workspace + kind gated). DB test. Wiring the record create path to read it remains.
- 2026-09-28: PR #206: admin-only update_workspace_id_prefixes RPC + SettingsGeneral prefix inputs (per record kind); DB and component tests. Wiring the record create path remains.
- 2026-09-28: PR #206: api.next_record_identifier defaults to the design prefix map (EXP/SMP/DS/PRT/MAT, protocols pad to 3) and api.create_record now assigns through it, keeping the H5 notebook-template guard and GOV-01 writer gate. Remaining create paths (create_model_record, create_scientific_record, create_file_upload, create_and_link_sheet_record, report builder) still use the legacy year scheme and need the same wiring.
- 2026-09-28: PR #206: create_model_record and internal.create_sheet_model_record now assign through api.next_record_identifier too, so every record-create path uses the workspace prefixes and never-reused sequence. Reports keep their own document_identifier. DB suite green (119 files, 1062 tests).
- 2026-09-28: PR #206: create_study now assigns through next_record_identifier (STD default), keeping the GOV-01 writer gate. No record-create path uses the year scheme any more; verified by scanning live function definitions.

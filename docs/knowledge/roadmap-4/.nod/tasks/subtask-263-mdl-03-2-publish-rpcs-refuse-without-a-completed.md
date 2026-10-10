---
id: subtask-263
title: MDL-03.2 — Publish RPCs refuse without a completed approval request
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-261
tags:
  - MDL-03.2
  - MDL
---

# MDL-03.2 — Publish RPCs refuse without a completed approval request

Step 2 of 3 in [MDL-03](../../tasks/MDL.md#mdl-03--approval-of-model-versions); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified against current code and closed. The step's own enumeration of what the approval mechanism is reusable by - models, parsers (DSET-06), protocols (LAB-07) and promotions (SHEET-02) - matches the publish paths that enforce it: publish_record_model_version, publish_dataset_schema_version, approve_parser_version and set_protocol_version_status all consult an approval request and refuse without a completed one (checked by function definition). The two sheet promotion RPCs (promote_calculation, promote_local_field) do not, but SHEET-02 owns applying the mechanism to promotions - its task says approval depends on MDL-03 and its exit is 'a promotion never writes dataset values before approval' - so that belongs to SHEET-02 rather than here. The other publish RPCs (publish_sheet_definition_version, publish_notebook_template_version, publish_pipeline_definition_version) are outside the step's enumeration and would need their own approval design.
- 2026-10-03: api.approval_requests (reusable: object kind, version id, required approver roles, state pending/approved/returned/withdrawn, submitter/approver/reasons) + decisions; submit/withdraw/approve/return RPCs; publish_dataset_schema_version refuses without a completed approval; independence enforced; pending approvals surface as an approval_requested work item for the required roles. Evidence: migration 0290 (applied to dev DB), tests/db/approval-requests.test.ts (9), full pnpm test:db 154/1257, pnpm test 3386, interactions/areas/phone/screens green, db:generate clean. Commit bb8eca02.

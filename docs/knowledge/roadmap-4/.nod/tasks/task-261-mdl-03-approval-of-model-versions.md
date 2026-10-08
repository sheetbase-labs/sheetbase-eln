---
id: task-261
title: MDL-03 — Approval of model versions
type: task
status: in-progress
priority: low
created: "2026-09-27"
updated: "2026-10-08"
parent: epic-251
related:
  - task-2
tags:
  - MDL-03
  - MDL
  - wave-E
---

# MDL-03 — Approval of model versions

Spec: [MDL-03 in tasks/MDL.md](../../tasks/MDL.md#mdl-03--approval-of-model-versions)

- Stream: MDL (epic-251)
- Wave: E
- Waits on: DEC-01 (task-2)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): not-started. Evidence: drizzle/0094_core_052_capabilities.sql:393-420 — publish requires capability/draft then immediately activates; no approval request; src/routes/models/$modelId/versions.tsx:37-44 — direct publish action; src/db/schema.ts — no approval_requests. Remaining: All three steps remain: reusable request/role/state model; approval-gated publication with independence/withdraw/return/work items; pending UI. Capability authorization is not approval. See docs/knowledge/roadmap-4/RECONCILIATION.md#mdl-03. Source audit, not fresh service/browser acceptance.
- 2026-10-03: All steps done; closed by roadmap sync.
- 2026-10-03: Exit not met: internal.approval_publish_blocker returns NULL when no request exists, so an unapproved dataset schema version can still be published. Chosen semantics 2026-10-03 (best practice): a workspace publication-approval policy. When enabled, publish_dataset_schema_version and siblings refuse without an approved request; when disabled the legacy direct publish remains; any existing request still locks and gates. To implement: workspace_settings column, blocker enforcement, DB tests (policy on/off, approver independence, denial), settings toggle.
- 2026-10-04: Dataset-schema publication policy integrated and DB/browser verified. Existing requests always gate; enabled policy requires current-revision approval. Record Models still lack versioned publication, so whole MDL-03 and step 2 remain open. Durable evidence in RECONCILIATION and migrations 0304-0305.
- 2026-10-08: Coordinator (local): Record Model version authority implemented as migration 0327 (record_model_versions, upgrades log, publish/upgrade RPCs) and the shared approval engine extended for record_model_version. tests/db/record-model-versions.test.ts passes 5/5; client/UI units 48. Remaining: browser/parity acceptance and the SHEET genuine pin-upgrade proof.

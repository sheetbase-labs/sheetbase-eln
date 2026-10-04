---
id: subtask-255
title: MDL-01.3 — Public API and SDK exposure
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-03"
parent: task-252
tags:
  - MDL-01.3
  - MDL
---

# MDL-01.3 — Public API and SDK exposure

Step 3 of 3 in [MDL-01](../../tasks/MDL.md#mdl-01--workspace-defined-record-models); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: record_models exposed through the public API (projects:read, workspace-scoped) and the OpenAPI/support matrix, with RecordModel types + list/get wrappers in the TypeScript and Python SDKs; workspace model records already exposed generically via records; migration 0288 grants api_client SELECT + a workspace-scoped policy (authoring RPCs stay authenticated-only). Evidence: tests/api/record-models.test.ts (6), public-api-openapi + sdk-support-matrix (30), TS SDK 92, full pnpm test:db 152/1241, pnpm test 3382, db:generate clean. Commit next.

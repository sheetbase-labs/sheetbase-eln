---
id: task-361
title: REV-04 — Evidence versus live
type: task
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-346
related:
  - task-2
tags:
  - REV-04
  - REV
  - wave-C
---

# REV-04 — Evidence versus live

Spec: [REV-04 in tasks/REV.md](../../tasks/REV.md#rev-04--evidence-versus-live)

- Stream: REV (epic-346)
- Wave: C
- Waits on: DEC-01 (task-2)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/evidence/$revisionId.tsx:69 — frozen revision fetched; lines 75-78 fetch live record for metadata, lines 149-154 only derive coarse drift from supersession/lock revision.; src/routes/evidence/$revisionId.tsx:153 — renders block_snapshot and stored digest, not cited-Dataset-versus-latest comparison or verified-at result.; tests/db/core-h3-frozen-composed-evidence.test.ts — canonical frozen composed evidence coverage exists; no nightly verification job found.. Remaining: 1 Source-aware snapshot/live comparison including renamed-record differences; 2 full evidence/phone presentation with frozen-only cited values (current route /evidence/$revisionId differs from planned nesting); 3 scheduled digest verification results. Existing snapshot summary/amendment entry is partial. See docs/knowledge/roadmap-4/RECONCILIATION.md#rev-04. Source audit, not fresh service/browser acceptance.

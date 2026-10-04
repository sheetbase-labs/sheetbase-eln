---
id: task-347
title: REV-01 — Review workspace
type: task
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-10-04"
parent: epic-346
related:
  - task-2
tags:
  - REV-01
  - REV
  - wave-C
---

# REV-01 — Review workspace

Spec: [REV-01 in tasks/REV.md](../../tasks/REV.md#rev-01--review-workspace)

- Stream: REV (epic-346)
- Wave: C
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/records/$recordId/notebook.tsx:941 — Open review navigates separate /review/$revisionId, not requested notebook review mode.; src/routes/review/$revisionId.tsx:326 — default comparison chooses immediately prior revision, not necessarily last reviewed round.; src/routes/review/$revisionId.tsx:272 — real review decisions/signatures/check-results exist; existing diff/check/comment UI remains baseline.; No private-draft comment publication/atomic return implementation found in current migrations/source.. Remaining: 1 Notebook review mode/round identity and retired route handling; 2 last-reviewed-round diff/margin/cell reason/navigation; 3 private reviewer drafts and atomic return-with-comments; 4 save draft/returned state and checklist results bound to decision. Existing separate review workspace remains useful partial implementation. See docs/knowledge/roadmap-4/RECONCILIATION.md#rev-01. Source audit, not fresh service/browser acceptance.
- 2026-10-04: PR #220 backend0309 checkpoint: canonical frozen grid keeps rowKeys/full field metadata and trusted Definition/Instance expression/result snapshots. Checks verify original digest then persisted evidence; invalid schema and missing/stale/error canonical results fail. Parent fresh DB3suites16tests, populated migration, unchanged snapshot schema/db:generate pass. Diff/UI/historical unavailable and REV/SCI workflow acceptance remain separate; full REV01 stays open.

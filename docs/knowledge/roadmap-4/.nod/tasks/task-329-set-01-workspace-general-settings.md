---
id: task-329
title: SET-01 — Workspace general settings
type: task
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: epic-328
related:
  - task-2
tags:
  - SET-01
  - SET
  - wave-B
---

# SET-01 — Workspace general settings

Spec: [SET-01 in tasks/SET.md](../../tasks/SET.md#set-01--workspace-general-settings)

- Stream: SET (epic-328)
- Wave: B
- Waits on: DEC-01 (task-2)
- Steps: 3 subtasks

## Work Log
  - 2026-10-10: every subtask of this task is done, so the task's own in-progress status was stale; closed after confirming the subtask statuses in .nod/tasks. Optical parity remains deferred by the owner's instruction.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/components/v3/settings/settings-general.tsx:56 — persisted general settings/prefix editing; lines 219-232 render editing rules as static statements.; src/lib/notebook-data.ts:539 and src/lib/workspace-admin.ts:648 — separate fixed en-GB formatters still exist; shared workspace-driven formatter replacement required by step 1 is not done.; drizzle/0231_record_identifier_assignment.sql:27 — prefix overrides used; lines 46-50 persist never-reused counter; drizzle/0234_identifier_assignment_paths.sql:21 extends assignment to model paths.; src/components/v3/settings/settings-general.tsx:177 — ID table has Record/Prefix/Example, no next number; example at line 209 is hardcoded prefix-2025-0001.; tests/db/workspace-general.test.ts:50 — settings/prefix permissions tests; tests/db/id-sequences.test.ts:53 — ID sequence tests present, not executed.. Remaining: 1 Finish applying chosen date/number formats across specified consumers (route currently /settings/, superseding proposed /settings/general needs explicit documentation); 2 expose authoritative next numbers as specified and verify no reuse/audit after prefix change; 3 enforce configured saved-value reasons, signing locks and offline permission on server. Reopen step 1 and step 2 full-scope done claims while retaining their implemented subsets. See docs/knowledge/roadmap-4/RECONCILIATION.md#set-01. Source audit, not fresh service/browser acceptance.

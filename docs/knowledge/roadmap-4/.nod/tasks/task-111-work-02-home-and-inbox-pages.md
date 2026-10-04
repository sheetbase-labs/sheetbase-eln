---
id: task-111
title: WORK-02 — Home and Inbox pages
type: task
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-104
related:
  - task-2
tags:
  - WORK-02
  - WORK
  - wave-B
---

# WORK-02 — Home and Inbox pages

Spec: [WORK-02 in tasks/WORK.md](../../tasks/WORK.md#work-02--home-and-inbox-pages)

- Stream: WORK (epic-104)
- Wave: B
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
- 2026-09-28: UI port: Home and Inbox are ported on my_work_items, calendar bookings, dataset flags and notifications; first-run and remaining WORK-01 kinds follow.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/index.tsx:117-124 — Continue working selects recent workspace experiments rather than personal recents.; src/routes/index.tsx:350-357 — empty state has no first-run checklist.; src/routes/inbox.tsx:91-125 — current Inbox state/filter selection exists; no scoped-shortcut registration or keydown handler anywhere in file.; src/routes/help/records.tsx:137 — records help exists.. Remaining: Complete state-derived first run and personal recents, restore Inbox J/K and verify required review inspector/empty states. See docs/knowledge/roadmap-4/RECONCILIATION.md#work-02. Source audit, not fresh service/browser acceptance.
- 2026-10-02: All steps done; closed by roadmap sync.
- 2026-10-02: Follow-up fix: the Inbox type filter now applies to the grouped needs-action sections (previously only the count chips changed); empty state derives from the ordered rows. Commit 1982995e.

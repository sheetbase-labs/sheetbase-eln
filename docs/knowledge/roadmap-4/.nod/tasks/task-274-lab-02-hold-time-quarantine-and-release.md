---
id: task-274
title: LAB-02 — Hold time, quarantine and release
type: task
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
parent: epic-269
related:
  - task-2
tags:
  - LAB-02
  - LAB
  - wave-D
---

# LAB-02 — Hold time, quarantine and release

Spec: [LAB-02 in tasks/LAB.md](../../tasks/LAB.md#lab-02--hold-time-quarantine-and-release)

- Stream: LAB (epic-269)
- Wave: D
- Waits on: DEC-01 (task-2)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): not-started. Evidence: src/routes/samples/$sampleId.tsx:109 — UI active state only distinguishes consumed/expired.; Search current src/drizzle found no hold_exceeded or release_sample implementation.; docs/knowledge/roadmap-4/tasks/LAB.md:95-114 — new hold/release job/rules are required beyond existing quarantine.. Remaining: Implement timed hold fields/system transition, allowed uses, measurement-based authorized release and disposal; existing generic sample status is baseline, not completion. See docs/knowledge/roadmap-4/RECONCILIATION.md#lab-02. Source audit, not fresh service/browser acceptance.
- 2026-10-03: All steps done; closed by roadmap sync.

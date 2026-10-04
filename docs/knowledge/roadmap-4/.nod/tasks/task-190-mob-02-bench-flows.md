---
id: task-190
title: MOB-02 — Bench flows
type: task
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-186
related:
  - task-2
tags:
  - MOB-02
  - MOB
  - wave-D
---

# MOB-02 — Bench flows

Spec: [MOB-02 in tasks/MOB.md](../../tasks/MOB.md#mob-02--bench-flows)

- Stream: MOB (epic-186)
- Wave: D
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/scan.tsx:72-106 — actual camera stream and BarcodeDetector scanning plus typed fallback.; src/routes/samples/$sampleId.tsx:59-65 — withdrawal uses consumeSample.; src/routes/readings/new.tsx:60-83 — standalone measurement insert, no planned row/range/dilution/photo.. Remaining: Finish planned-row reading with scientific validation/dilution/photo, destination-aware withdrawal/numeric keypad and evidence/model record phone acceptance; scan is implemented but full bench exit not met. See docs/knowledge/roadmap-4/RECONCILIATION.md#mob-02. Source audit, not fresh service/browser acceptance.

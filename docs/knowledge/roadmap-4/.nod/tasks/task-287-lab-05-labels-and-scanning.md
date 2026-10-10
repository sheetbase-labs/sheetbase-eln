---
id: task-287
title: LAB-05 — Labels and scanning
type: task
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: epic-269
related:
  - task-2
  - task-11
tags:
  - LAB-05
  - LAB
  - wave-D
---

# LAB-05 — Labels and scanning

Spec: [LAB-05 in tasks/LAB.md](../../tasks/LAB.md#lab-05--labels-and-scanning)

- Stream: LAB (epic-269)
- Wave: D
- Waits on: DEC-01 (task-2), DEC-10 (task-11)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/scan.tsx:75-87 — BarcodeDetector capability test and camera path; typed fallback when unsupported.; Current src/routes inventory has no /r/$identifier resolver and no label/print route.; docs/knowledge/roadmap-4/tasks/LAB.md:199-236 — accepted browser-print URL payload decision.. Remaining: Implement label model/QR render and audited browser print, stable URL resolver and scanner fallback; verify printed-label round trip and history. Existing typed scan is not label completion. See docs/knowledge/roadmap-4/RECONCILIATION.md#lab-05. Source audit, not fresh service/browser acceptance.
- 2026-10-10: All steps done; closed by roadmap sync.

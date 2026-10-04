---
id: task-240
title: SHEET-04 — Templates
type: task
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-226
related:
  - task-2
tags:
  - SHEET-04
  - SHEET
  - wave-C
---

# SHEET-04 — Templates

Spec: [SHEET-04 in tasks/SHEET.md](../../tasks/SHEET.md#sheet-04--templates)

- Stream: SHEET (epic-226)
- Wave: C
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/components/v3/templates/templates-data.ts:20-22,111-128 — notebook-template catalogue and in-use counts; src/routes/templates/$templateId/update.tsx:45-79 — real preview and revision-checked apply; src/lib/notebook-template-data.ts — existing canonical lifecycle/upgrade RPCs. Remaining: 1 REUSE-02 old failing component was retired; no fresh proof of equivalent default-value regression acceptance located, do not perpetuate historical failure as current. 2 catalogue notebook-only, not notebook/sheet/record across kinds. 3 editor incomplete for all sheet field definitions/change/impact scope. 4 update preview/apply exists; notebook banner and signed/no-rewrite end-to-end acceptance remain unverified. See docs/knowledge/roadmap-4/RECONCILIATION.md#sheet-04. Source audit, not fresh service/browser acceptance.

---
id: subtask-281
title: LAB-03.3 — Measurements tab
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
parent: task-278
tags:
  - LAB-03.3
  - LAB
---

# LAB-03.3 — Measurements tab

Step 3 of 4 in [LAB-03](../../tasks/LAB.md#lab-03--sample-record-pages); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: Measurements tab resolved: read-only aggregation via api.sample_measurement_provenance (migration 0280) joining dataset rows linked to the sample (reference field or sample-keyed text) and instrument QC results, each with dataset/row/field or run/instrument provenance and a source link; the editable standalone recording is removed from the tab (RPC retained for MOB-02). Evidence: tests/db/sample-measurement-provenance.test.ts (6), full pnpm test:db 145/1187, pnpm test 3283, interactions/areas/screens green. Commit d4f0d533.

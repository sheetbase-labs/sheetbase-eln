---
id: subtask-260
title: MDL-02.4 — Versions tab
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-03"
parent: task-256
tags:
  - MDL-02.4
  - MDL
---

# MDL-02.4 — Versions tab

Step 4 of 4 in [MDL-02](../../tasks/MDL.md#mdl-02--model-editor); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: Versions tab: per-version field changes vs the previous version (added/changed/removed with detail), record count pinned per version, and record impact (new records only / unchanged / not published) from the pinning invariant. Evidence: model-version-impact.test.ts + models-data.test.ts (8), pnpm test, interactions/areas/screens green. Commit next. GAPS (reported, not fabricated): no stored reason-for-change and no per-version migration outcome; publish forks a version without rebinding datasets. NOTE: this improves the existing Dataset-schema-backed Models board; ADR-0051 requires the MDL editor to move onto the record_models host (deeper MDL-02 work).

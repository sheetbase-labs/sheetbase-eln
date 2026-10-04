---
id: subtask-276
title: LAB-02.2 — Release checks
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
parent: task-274
tags:
  - LAB-02.2
  - LAB
---

# LAB-02.2 — Release checks

Step 2 of 3 in [LAB-02](../../tasks/LAB.md#lab-02--hold-time-quarantine-and-release); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: Release rule set (api.sample_release_rules per workspace/type with canonical fallback) evaluated against api.sample_measurement_provenance; api.release_sample (sample.release, SB093 on failed checks, records releasedAt + releaseChecks + event), quarantine_sample/dispose_sample (capability + mandatory reason + canonical event), consume_sample refuses quarantined/hold_exceeded unless the experiment is allowed. Evidence: migration 0282 (applied to dev DB), tests/db/sample-release.test.ts (11), full pnpm test:db 147/1205, pnpm test, interactions/areas/screens green, db:generate clean. Commit next.

---
id: subtask-35
title: DSYS-05.2 — One PR per screen group
type: subtask
status: todo
priority: high
created: "2026-09-27"
updated: "2026-09-28"
parent: task-33
tags:
  - DSYS-05.2
  - DSYS
---

# DSYS-05.2 — One PR per screen group

Step 2 of 4 in [DSYS-05](../../tasks/DSYS.md#dsys-05--design-data-seed); the full step text is under “Steps” there.

## Work Log
- 2026-09-27: PR #205: datasets screen group seeded (Ambr 250 daily readings 84 rows/7 snapshots; ELISA capsid titre and turbidity 96 rows/15 snapshots) through the canonical dataset RPCs.
- 2026-09-27: PR #206: work-items screen group seeded — Gareth's EXP-0138 review (due +7 days), two followed records and a failed pipeline run; verified via api.my_work_items as Gareth P.
- 2026-09-27: PR #206: bookings screen slice — Ambr 250 resource and today's three design bookings (sampling, plate reader, tech-transfer review) for the Home Today section.
- 2026-09-28: PR #206: samples screen slice — added the design's remaining sample identifiers (SMP-2190..2250). design:coverage rose 196→249 of 765.
- 2026-09-28: PR #206: protocols screen slice — added PRT-009/012/017/019/020/021/022/025. design:coverage 249→287.
- 2026-09-28: PR #206: materials screen slice — design materials MAT-0342..0421 as reagent records with supplier/lot/expiry. design:coverage 287→334.
- 2026-09-28: PR #206: experiments screen slice — added EXP-0091..EXP-0146 with design titles/statuses. design:coverage 334→394.

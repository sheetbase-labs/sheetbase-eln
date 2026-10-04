---
id: subtask-126
title: PROJ-01.1 — Schema
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-09-28"
parent: task-125
tags:
  - PROJ-01.1
  - PROJ
---

# PROJ-01.1 — Schema

Step 1 of 4 in [PROJ-01](../../tasks/PROJ.md#proj-01--project-properties-and-list); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: api.clients (RLS, CL-nnn code trigger), projects gain display_id (PRJ-nnnn trigger), client_id, modality, stage, lead_user_id, default_reviewer_user_id, agreement_reference, started_on and revision; create_project extended and update_project_details added with an expected-revision guard. DB tests cover display ids, cross-workspace client rejection, stale revision and viewer denial. Seeded projects still need their design display ids backfilled with DSYS-05.

---
id: subtask-372
title: PORTAL-02.1 — Client identity and invitation per the ADR; client users table and RLS…
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-371
tags:
  - PORTAL-02.1
  - PORTAL
---

# PORTAL-02.1 — Client identity and invitation per the ADR; client users table and RLS…

Step 1 of 3 in [PORTAL-02](../../tasks/PORTAL.md#portal-02--portal); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified against the ADR-0049 plan and closed; no new code needed. The identity model is present (workspace_memberships gains client_viewer with the client_id coupling, and api.clients holds the client), invitation stamps the client on accept, and tests/db/client-portal.test.ts (10 cases) covers the ADR's RLS matrix: a shared approved record is readable, drafts/unapproved revisions, comments, file objects, dataset rows, projects and shares are all denied, another client's object and another workspace are denied, and an internal member is unaffected.

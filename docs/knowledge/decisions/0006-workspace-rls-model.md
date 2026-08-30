# 0006. Workspace row-level security model

- **Status:** accepted
- **Date:** 2026-07-18
- **Ticket:** AUTH-004

## Context

Every workspace-owned table must be isolated by workspace, with owner-only
operations separated from ordinary member operations. The claim set
(AUTH-003) gives RLS a `workspace_id` and `sub` to compare against. Two
forces conflicted: keep `internal` closed to request roles (decision 0002),
and give RLS policies helpers that can read membership without recursing
through the very RLS they gate.

## Decision

- RLS is enabled on `api.workspaces`, `api.workspace_memberships` and
  `api.projects`. It is not `FORCE`d: the request roles (`anon`,
  `authenticated`) are not the table owner, so RLS is already authoritative
  for every API path. The owner (`migrator`) bypasses RLS for migrations,
  seed and bootstrap; production bootstrap runs as the `DATABASE_URL`
  superuser. `FORCE` would break those without adding protection to normal
  API use.
- Claim-reader helpers live in `api`, not `internal`: `current_user_id`,
  `current_workspace_id`, and `is_workspace_member`. They reuse
  `api.claim_probe` (AUTH-003) and are defensive — missing, empty or
  malformed claims yield `NULL`, so policy comparisons fail closed.
- `is_workspace_member` is `SECURITY DEFINER` (owned by `migrator`,
  `search_path = ''`) so it can read `api.workspace_memberships` without
  recursing through that table's RLS.
- Owner-only operations: workspace metadata update, membership
  insert/update/delete, project delete. Member operations: read,
  project insert/update. Workspace and membership creation are service
  operations, not exposed to `authenticated` via PostgREST.
- Every `INSERT` and `UPDATE` `WITH CHECK` pins `workspace_id` (or `id` for
  `workspaces`) to the active claim, so inserts cannot target another
  workspace and updates cannot move records between workspaces.

## Consequences

- Adding a workspace-owned table is now a four-step checklist: enable RLS,
  add a `workspace_id` (or `id`) pinning `WITH CHECK`, add a membership
  predicate via `is_workspace_member`, and add a two-workspace isolation
  test.
- Owner-only checks read the membership role through `is_workspace_member`,
  so future role vocabularies (e.g. `admin`) extend the helper, not every
  policy.
- `anon` has no policies and no table grants; it sees nothing. Any new
  public read surface must be added deliberately, not by default.
- Application-level checks (AUTH-003 proxy) may improve error messages but
  are never the only boundary — RLS is.

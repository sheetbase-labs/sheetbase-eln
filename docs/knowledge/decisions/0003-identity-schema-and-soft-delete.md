# 0003. Identity schema placement and soft-delete semantics

- **Status:** accepted
- **Date:** 2026-07-18
- **Ticket:** API-003

## Context

Phase 1 needs Better Auth identity tables and the first domain tables
(workspaces, memberships, projects). Two durable choices: where identity
tables live and which naming they follow, and how users/workspaces/projects
are removed without destroying audit history.

## Decision

- Better Auth core tables (`user`, `session`, `account`, `verification`)
  live in `internal`, hidden from PostgREST, and keep Better Auth's quoted
  camelCase column convention. That is a deliberate, scoped exception to the
  snake_case rule: these tables belong to Better Auth's contract, not to
  Sheetbase domain naming. Domain tables never reference them from the
  exposed surface except by the user's stable id.
- Domain tables (`api.workspaces`, `api.workspace_memberships`,
  `api.projects`) use the standard snake_case conventions with uuid primary
  keys and, where a record is user-facing, a separate immutable public
  identifier (`projects.key` per workspace).
- Removal is archival, not deletion: `status` plus `archived_at` marks a
  workspace or project as archived. Product flows never hard-delete records
  that audit history may reference. Foreign keys use `ON DELETE CASCADE` so
  an administrative hard delete cannot leave orphaned rows — but cascades
  are a data-integrity backstop, not a product feature.
- `updated_at` on `api` tables is database-maintained by trigger, never by
  application code alone.

## Consequences

- Renaming or deleting a user or workspace does not rewrite history;
  consumers must tolerate archived-but-present records.
- Any new `api` table with `updated_at` must add the trigger in the same
  migration that creates the table.
- Better Auth upgrades may adjust its core tables; those changes stay inside
  `internal` and do not rename domain columns.

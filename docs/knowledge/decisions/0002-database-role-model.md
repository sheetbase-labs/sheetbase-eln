# 0002. Database role model and exposed-schema boundary

- **Status:** accepted
- **Date:** 2026-07-18
- **Ticket:** API-002

## Context

PostgreSQL and RLS are the authoritative access-control boundary
(`TODO.md`). That requires the privilege model to exist before any domain
table does: which roles connect, which schemas PostgREST exposes, and what
happens when a table forgets its grants. Roles also carry passwords, which
migrations must never contain.

## Decision

- Five product roles: `migrator` (owns objects, runs DDL), `authenticator`
  (PostgREST's only credential, no table rights), `anon` and `authenticated`
  (request roles), `service_role` (narrow service operations).
- Roles are created once per cluster by `docker/db/init/00-roles.sh` with
  passwords from the environment; grants and schema privileges live only in
  migrations. The database is owned by `migrator`.
- PostgREST exposes exactly the `api` schema. `internal` holds identity,
  credential and audit plumbing. `public` stays empty with defaults revoked.
- Default privileges grant nothing: a new object with no explicit GRANT is
  inaccessible to request roles (fails closed).

## Consequences

- Every migration that creates an exposed object must also write its GRANTs
  and RLS policies; the `tests/db` layer proves the closed default.
- Rotating a role password means an environment change plus the init script,
  not a migration.
- Running DDL as a superuser outside the bootstrap script is forbidden in
  normal development; the superuser is for bootstrap and test-database
  administration only.

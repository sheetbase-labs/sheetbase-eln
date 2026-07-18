# Database access model

How roles, schemas and privileges divide the database, and how an HTTP
request's claims reach row-level-security policies. Settled by API-002; see
`docs/decisions/0002-database-role-model.md`.

## Roles

| Role            | Login | Purpose                                                                                                                                                           |
| --------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrator`      | yes   | Owns the database and all schema objects. Runs migrations (Drizzle) and DDL. Never used by the app or PostgREST at request time.                                  |
| `authenticator` | yes   | The only credential PostgREST holds. Holds no table rights; can only `SET ROLE` to `anon` or `authenticated`.                                                     |
| `anon`          | no    | Unauthenticated requests. USAGE on `api`, nothing else by default.                                                                                                |
| `authenticated` | no    | Signed-in requests. Per-object grants in each migration.                                                                                                          |
| `service_role`  | no    | Narrowly controlled service operations (token exchange, workers). Per-object grants only.                                                                         |
| `sheetbase`     | yes   | Local bootstrap superuser, created by the postgres image. Used by compose health checks, the init script and test-database administration — never by the product. |

Passwords exist only in `.env.local` (see `.env.example`) and enter the
cluster through `docker/db/init/00-roles.sh` at volume initialisation.
Migrations contain no passwords.

## Schemas

- `api` — the only schema PostgREST exposes (`PGRST_DB_SCHEMAS=api`). Safe
  CRUD tables, read-only views and mutation RPCs live here.
- `internal` — everything PostgREST must never see: identity plumbing,
  credentials, audit and change tables. Only `migrator` and `service_role`
  may enter, and `service_role` only with per-object grants.
- `public` — empty. Broad defaults revoked; nothing user-owned may be
  created here.

Every workspace-owned table gets row-level security; RLS is the access-control
boundary, application checks only improve error messages (see `TODO.md`).

## Object conventions in `api`

Three shapes, chosen per capability:

1. **Safe CRUD tables** — ordinary tables with per-role `GRANT SELECT /
INSERT / UPDATE / DELETE` and RLS policies. Default choice.
2. **Read-only views** — for composite reads a client should not assemble
   itself. `GRANT SELECT` only, with `security_invoker = true` so the view
   runs with the caller's permissions.
3. **Mutation RPCs** — `security definer` functions under `/rpc/` for
   operations direct CRUD cannot keep consistent (multi-row transactions,
   bootstrap flows). Definer functions pin `SET search_path = ''`, qualify
   every object, and are granted `EXECUTE` per role explicitly.

A table that forgets its GRANTs fails closed: default privileges grant
nothing.

## How claims become session settings

PostgREST verifies the request JWT against `PGRST_JWT_SECRET`. Every claim
is then exposed to SQL as `request.jwt.claims`:

```sql
current_setting('request.jwt.claims', true)::jsonb ->> 'workspace_id'
```

The `role` claim chooses the PostgreSQL role PostgREST switches to (`anon`
or `authenticated`); any other claim (`sub`, `workspace_id`, session id) is
readable the same way inside RLS policies. AUTH-003 defines the exact claim
set; AUTH-004 writes the policies that consume them.

## Row-level security (AUTH-004)

Every workspace-owned table (`api.workspaces`, `api.workspace_memberships`,
`api.projects`) has RLS enabled. The request roles (`anon`, `authenticated`)
are not the table owner, so RLS is authoritative for every API path without
`FORCE`. The owner (`migrator`) bypasses RLS for migrations, seed and
bootstrap; the production bootstrap path runs as the `DATABASE_URL`
superuser. See decision record 0006.

Claim-reader helpers live in `api` (where `authenticated` has `USAGE`),
not `internal` — decision record 0002 closes `internal` to request roles,
and these helpers read only GUCs and `api.workspace_memberships`, never
`internal` data. They reuse `api.claim_probe` (AUTH-003) and are defensive:
missing, empty or malformed `request.jwt.claims` yield `NULL`, so every
policy comparison fails closed — zero rows, never an error that leaks
structure.

- `api.current_user_id()` → the `sub` claim, or `NULL`.
- `api.current_workspace_id()` → the `workspace_id` claim as uuid, or `NULL`.
- `api.is_workspace_member(workspace_id, role?)` → whether the caller is a
  member (or member with a given role) of the workspace. `SECURITY DEFINER`
  so it can read `api.workspace_memberships` without recursing through that
  table's RLS.

Policy model (per table):

| Table                   | SELECT | INSERT                      | UPDATE                         | DELETE         |
| ----------------------- | ------ | --------------------------- | ------------------------------ | -------------- |
| `workspaces`            | member | — (service op)              | owner                          | — (service op) |
| `workspace_memberships` | member | owner (own workspace only)  | owner (cannot move workspace)  | owner          |
| `projects`              | member | member (own workspace only) | member (cannot move workspace) | owner          |

Every `INSERT` and `UPDATE` `WITH CHECK` pins `workspace_id` (or `id` for
`workspaces`) to `api.current_workspace_id()`, so inserts cannot choose
another workspace and updates cannot move records between workspaces.
`anon` has no policies and no table grants, so it sees nothing.

`tests/db/workspace-rls.test.ts` proves read isolation, the insert/update/
delete boundaries, owner-only operations and the missing-claim and anon
failure paths using two workspaces and three users.

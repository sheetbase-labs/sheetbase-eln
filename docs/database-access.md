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
set and AUTH-004 writes the policies that consume them; nothing may be
trusted until both exist.

Designated helpers (added with AUTH-004) will read claims defensively:
missing or malformed claims must yield "no workspace context", and RLS must
then return zero rows — never an error that leaks structure.

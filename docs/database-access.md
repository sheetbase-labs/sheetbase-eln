# Database access model

This page describes how roles, schemas, and privileges divide the database.
It also shows how an HTTP request's claims reach row-level-security policies.
API-002 settled this model; see `docs/decisions/0002-database-role-model.md`.

## Roles

| Role            | Login | Purpose                                                                                                                                                           |
| --------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrator`      | yes   | Owns the database and all schema objects. Runs migrations (Drizzle) and DDL. The app and PostgREST do not use it at request time.                                  |
| `authenticator` | yes   | The only credential PostgREST holds. It has no table rights; it can only `SET ROLE` to `anon` or `authenticated`.                                                     |
| `anon`          | no    | Serves unauthenticated requests. Has USAGE on `api` and nothing else by default.                                                                                                |
| `authenticated` | no    | Serves signed-in requests. Gets per-object grants in each migration.                                                                                                          |
| `service_role`  | no    | Performs narrow service operations (token exchange, workers). Gets per-object grants only.                                                                         |
| `sheetbase`     | yes   | Local bootstrap superuser, created by the postgres image. Used by compose health checks, the init script, and test-database administration. The product never uses it. |

Passwords exist only in `.env.local` (see `.env.example`). They enter the
cluster through `docker/db/init/00-roles.sh` at volume initialisation.
Migrations contain no passwords.

## Schemas

- `api` — the only schema PostgREST exposes (`PGRST_DB_SCHEMAS=api`). Safe
  CRUD tables, read-only views, and mutation RPCs live here.
- `internal` — PostgREST must never see this schema: identity plumbing,
  credentials, audit and change tables. Only `migrator` and `service_role`
  may enter, and `service_role` enters only with per-object grants.
- `public` — empty. Broad defaults are revoked; nothing user-owned may be
  created here.

Every workspace-owned table gets row-level security. RLS is the access-control
boundary; application checks only improve error messages (see `TODO.md`).

## Object conventions in `api`

Each capability uses one of three shapes:

1. **Safe CRUD tables** — ordinary tables with per-role `GRANT SELECT /
   INSERT / UPDATE / DELETE` and RLS policies. This is the default choice.
2. **Read-only views** — for composite reads that a client should not
   assemble itself. `GRANT SELECT` only, with `security_invoker = true`, so
   the view runs with the caller's permissions.
3. **Mutation RPCs** — `security definer` functions under `/rpc/` for
   operations direct CRUD cannot keep consistent (multi-row transactions,
   bootstrap flows). Definer functions pin `SET search_path = ''`, qualify
   every object, and get `EXECUTE` per role explicitly.

A table that forgets its GRANTs fails closed: default privileges grant
nothing.

## How claims become session settings

PostgREST verifies the request JWT against `PGRST_JWT_SECRET`. It then
exposes every claim to SQL as `request.jwt.claims`:

```sql
current_setting('request.jwt.claims', true)::jsonb ->> 'workspace_id'
```

The `role` claim chooses the PostgreSQL role PostgREST switches to (`anon`
or `authenticated`). Any other claim (`sub`, `workspace_id`, session id) is
readable the same way inside RLS policies. AUTH-003 defines the exact claim
set. AUTH-004 writes the policies that consume them.

## Row-level security (AUTH-004)

Every workspace-owned table (`api.workspaces`, `api.workspace_memberships`,
`api.projects`) has RLS enabled. The request roles (`anon`, `authenticated`)
do not own the tables, so RLS is authoritative for every API path without
`FORCE`. The owner (`migrator`) bypasses RLS for migrations, seed, and
bootstrap; the production bootstrap path runs as the `DATABASE_URL`
superuser. See decision record 0006.

Claim-reader helpers live in `api` (where `authenticated` has `USAGE`), not
in `internal`. Decision record 0002 closes `internal` to request roles. These
helpers read only GUCs and `api.workspace_memberships`, never `internal`
data. They reuse `api.claim_probe` (AUTH-003) and are defensive: missing,
empty, or malformed `request.jwt.claims` yield `NULL`. Every policy
comparison then fails closed — zero rows, never an error that leaks
structure.

- `api.current_user_id()` → the `sub` claim, or `NULL`.
- `api.current_workspace_id()` → the `workspace_id` claim as uuid, or `NULL`.
- `api.is_workspace_member(workspace_id, role?)` → whether the caller is a
  member (or a member with a given role) of the workspace. `SECURITY DEFINER`
  lets it read `api.workspace_memberships` without recursing through that
  table's RLS.

Policy model (per table):

| Table                   | SELECT | INSERT                      | UPDATE                         | DELETE         |
| ----------------------- | ------ | --------------------------- | ------------------------------ | -------------- |
| `workspaces`            | member | — (service op)              | owner                          | — (service op) |
| `workspace_memberships` | member | owner (own workspace only)  | owner (cannot move workspace)  | owner          |
| `projects`              | member | member (own workspace only) | member (cannot move workspace) | owner          |

Every `INSERT` and `UPDATE` `WITH CHECK` pins `workspace_id` (or `id` for
`workspaces`) to `api.current_workspace_id()`. Inserts cannot choose another
workspace. Updates cannot move records between workspaces. `anon` has no
policies and no table grants, so it sees nothing.

`tests/db/workspace-rls.test.ts` proves read isolation, the insert/update/
delete boundaries, owner-only operations, and the missing-claim and anon
failure paths. It uses two workspaces and three users.

## First vertical slice (API-004)

The `api.projects` table is the first PostgREST-exposed resource the
application uses:

- **Read:** `GET /api/db/projects?order=created_at.desc` — list projects,
  newest first. RLS scopes rows to the caller's workspace.
- **Create:** `POST /api/db/rpc/create_project` with `{ p_title }` — the
  server generates a stable per-workspace `key` (slugified title, with a
  numeric suffix on collision) and returns the created row. RLS also permits
  direct INSERT. The RPC guarantees unique, well-formed keys without a
  client round-trip.
- **Update/delete:** direct CRUD through `/api/db/projects`. The
  `projects_update` (member) and `projects_delete` (owner) RLS policies gate
  these operations.

The browser reaches all of these through the same-origin `/api/db` boundary
via `src/lib/data-client.ts`. It never talks to PostgREST directly.
`tests/db/create-project-rpc.test.ts` is the contract proof.

## Notebook domain (ELN-002)

The notebook domain extends the workspace-owned surface with five tables.
Migration `0008_powerful_celestials` creates the schema. Migration
`0009_eln_notebook_domain` adds RLS, grants, triggers, integrity guards, and
the `create_record` RPC. Decision record 0015 fixes the vocabulary.

| Table          | workspace_id | SELECT | INSERT                      | UPDATE                         | DELETE        |
| -------------- | ------------ | ------ | --------------------------- | ------------------------------ | ------------- |
| `folders`      | on row       | member | member (own workspace)      | member (cannot move workspace) | owner         |
| `records`      | on row       | member | member (own workspace)      | member (cannot move workspace) | owner         |
| `blocks`       | via record   | member | member (record not deleted) | member (record not deleted)    | member        |
| `record_links` | via source   | member | member (record not deleted) | member (record not deleted)    | member        |
| `revisions`    | via record   | member | member (record not deleted) | — (immutable)                  | — (immutable) |

`blocks`, `record_links`, and `revisions` do not carry `workspace_id`. They
inherit it through their parent `record`. The workspace root stays
authoritative; the column is not duplicated on every descendant row.

RLS alone cannot express these integrity guards:

- `uq_blocks_record_order` — unique `(record_id, order)` prevents duplicate
  ordering positions at the database. `order` is `real`, so fractional
  indexing supports insert/move without rewriting every block. Move/insert
  RPCs (ELN-003) rebalance when precision runs out.
- `assert_record_link_same_workspace` trigger — a `record_links` row whose
  `target_record_id` is set may not point at a record in a different
  workspace. RLS already prevents reading across workspaces. This trigger
  prevents a writer from forging a link to an invisible target.
- `revisions` are append-only history. Grants give `authenticated` and
  `api_client` `SELECT`/`INSERT` only, so UPDATE and DELETE fail closed at
  the privilege layer.

`api.create_record(p_project_id, p_kind, p_title, p_status, p_tags)` assigns
a stable, type-prefixed, project-scoped identifier (`EXP-`/`PRT-`/`RPT-`
`YYYY-NNNN`) server-side. It runs as `SECURITY INVOKER`; the `INSERT` inside
is still subject to `records_insert` RLS (defence in depth). Clients cannot
collide, pick poor identifiers, or guess another project's identifiers.

`tests/db/notebook-schema.test.ts` is the schema/RPC contract proof.
`tests/db/notebook-rls.test.ts` is the RLS isolation proof.

## Scientific tables (DATA-002)

`scientific_tables`, `scientific_columns`, and
`scientific_category_options` are read-only metadata resources. Controlled
RPCs own all physical DDL: `create_scientific_table`,
`add_scientific_column`, `update_scientific_column_display`,
`convert_scientific_column`, and `retire_scientific_column`. Generated
relations are normal `api` resources with workspace-bound checks and RLS.
Request roles get row reads/deletes and column-level writes only for managed
literal fields. Machine names are immutable database-generated `sheet_…` and
`col_…` names; labels never become SQL identifiers. Schema and row changes
emit lightweight events without scientific values. DATA-002 grants metadata,
generated rows, and management RPCs only to authenticated workspace members.
`api_client` scientific access and its explicit scopes are intentionally
deferred to DATA-003. The shared event transport already carries credential
attribution for future verified direct paths.

`api.add_scientific_column(uuid, integer, text, text, boolean, jsonb, jsonb,
jsonb, jsonb)` takes table id, expected schema version, label, logical type,
nullable, default, unit, validation, and ordered category options. Options
are strict `{ "id"?: uuid, "label": string }` objects. Every non-category
type rejects options. A required category added to a populated relation must
have both an explicit option UUID and a default that selects one of the
supplied options. Option metadata, physical DDL, and backfill are one
transaction.

Display/reorder, retirement, and conversion serialize on the owning table
and then on the column metadata row. They reject stale schema versions after
those locks. Reorder addresses active columns only and emits all shifted
stable column IDs. Retirement and conversion are confirmation RPCs. An
omitted confirmation hash returns locked evidence (including literal/cast
and formula-marker counts). Execution requires the exact hash against
freshly recomputed evidence. Retirement revokes writes without dropping
physical data. Conversion rejects formula-owned columns and preserves
generated-row identity/version/timestamps. It currently supports integer to
decimal, plus unvalidated/default-free text to integer, decimal, boolean,
date, or timestamp.

## Formula results (CALC-004)

`formula_definitions` and `formula_dependencies` are read-only provenance
resources. `formula_results` is a security-invoker, RLS-protected view over
the internal revision-bound cache. It exposes `calculated_value` only when
the formula version and notebook `calculation_input_revision` match a
completed server calculation. Its `calculation_status` distinguishes
`pending`, `current`, `stale`, `failed`, and `unavailable`. Structured
current calculation errors use `calculation_error_code`. Generated sheet
resources never substitute these derived values for literals. Browser
members and external credentials with `scientific:read` can query all three
resources within their claimed workspace.

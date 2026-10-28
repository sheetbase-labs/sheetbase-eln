# Data access for stewards

Members in a role the workspace gave **data access** see technical details in
the app (keys, API routes, Postgres names) and can create a personal read-only
SQL login. Owners and administrators choose the roles in Settings → Access
(default: steward). `api.has_data_access()` is the authority; the app mirrors it.

## What a SQL login can do

- Log in as `sbl_<id>` and `SELECT` from the `data` schema: one view per model
  (`experiments`, `samples`, a subtype's own key, ...), with typed columns for
  every active field. Regenerated whenever a model publishes.
- It sees exactly what its member sees. `api.claim_probe()` maps the login's
  `session_user` to the member, and the views are read through functions owned
  by `reporting_owner`, a member of `authenticated`, so every row level security
  policy applies. A login never reads `request.jwt.claims`.
- It cannot write, create objects, or read any other schema.
- It stops working at once when it is revoked or expires, when its member is
  suspended, or when the member's role loses data access.

Measurement tables have no SQL view yet; use their `api.<resource_name>` route.

## Deployment

- Role bootstrap (`docker/db/init/00-roles.sh`, `.agents/setup`) creates
  `reporting_reader`, `reporting_owner`, and gives `migrator` CREATEROLE. On a
  database bootstrapped earlier, run as a superuser:
  `ALTER ROLE migrator CREATEROLE; CREATE ROLE reporting_reader NOLOGIN NOINHERIT;
CREATE ROLE reporting_owner NOLOGIN; GRANT authenticated TO reporting_owner;
GRANT reporting_reader TO migrator WITH ADMIN OPTION; GRANT reporting_owner TO migrator;`
  then re-run the migration step or
  `SELECT internal.regenerate_reporting_views(id) FROM api.workspaces;`.
  Until then the migration succeeds and SQL access stays off.
- `SHEETBASE_SQL_HOST` (and optional `SHEETBASE_SQL_PORT`,
  `SHEETBASE_SQL_DATABASE`) tell the app where logins connect. The database
  must be reachable from where stewards work; do not expose it publicly without
  a deliberate decision. Unset, the app says SQL access isn't set up.
- Creating a login runs `CREATE ROLE ... PASSWORD` in the database. If you log
  statements (`log_statement = ddl`), that password is logged.

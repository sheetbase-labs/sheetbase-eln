# Pipeline execution operations

How pipeline runs are sandboxed, queued and evidenced, and what an operator has
to provision. Design: [Pipelines](../subsystems/pipelines.md) and
[ADR-0056](../knowledge/decisions/0056-pipeline-execution-hardening.md).

## The sandbox login

Transform SQL runs on its own connection as `pipeline_sandbox`: a login role with
no grants, no role memberships and a connection limit. New databases get it from
`docker/db/init/00-roles.sh` (password from `PIPELINE_SANDBOX_PASSWORD`);
`.agents/setup` does the same for a local cluster.

**An existing database predates the role and must be upgraded once**, as a
superuser, because the init script only runs on first initialisation of the data
volume:

```sql
CREATE ROLE pipeline_sandbox LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 32 PASSWORD '<generate a strong password>';
ALTER ROLE pipeline_sandbox SET temp_file_limit = '1GB';
ALTER ROLE pipeline_sandbox SET statement_timeout = '90s';
ALTER ROLE pipeline_sandbox SET idle_session_timeout = '10min';
ALTER ROLE pipeline_sandbox SET search_path = pg_temp;
```

Then set `PIPELINE_SANDBOX_DATABASE_URL=postgresql://pipeline_sandbox:<password>@<host>/<database>`
in the secret manager and roll the app. Until it is set, SQL steps fail with
"The pipeline SQL sandbox is not configured" (they fail closed). Never point it
at `DATABASE_URL`: the point of the role is that it holds nothing.

The connection limit caps concurrent SQL steps across the cluster (two per
worker by default), so raise it with the number of replicas.

## The run queue and workers

Every started run has a job in `internal.pipeline_run_jobs`; the server starts a
worker that works the queue. Settings:

| Variable                      | Default | Effect                                                            |
| ----------------------------- | ------- | ----------------------------------------------------------------- |
| `SHEETBASE_PIPELINE_WORKER`   | on      | `false` stops this replica working the queue (it still enqueues). |
| `PIPELINE_WORKER_CONCURRENCY` | 2       | Jobs this worker runs at once (1 to 8).                           |

Runs in one workspace execute one at a time; different workspaces run in
parallel. To see the queue:

```sql
SELECT state, kind, count(*), min(enqueued_at) AS oldest
  FROM internal.pipeline_run_jobs
 WHERE state IN ('queued', 'claimed') GROUP BY 1, 2;
```

A `queued` job that is old means no worker is serving the queue (check
`SHEETBASE_PIPELINE_WORKER` and the application logs for "pipeline worker pass
failed"). A `claimed` job whose `lease_expires_at` is in the past is re-claimed
automatically. A job that reaches `dead` has failed its run with `worker_lost` or
`job_failed`; `last_error` says why. After an hour with no worker a queued job
stops counting as live, and the existing staleness reconciliation frees the run.

## Signed run manifests

A succeeded run records a manifest (`api.pipeline_run_manifests`). Without a key
it is hashed and chained; with `PIPELINE_MANIFEST_SIGNING_KEY` it is also signed.
Generate a key once per environment and keep it in the secret manager:

```sh
openssl genpkey -algorithm ed25519
```

Set the PEM (a single line with `\n` escapes is accepted). A key that is set but
not Ed25519 fails runs at completion rather than writing unsigned evidence.
Rotating the key changes `key_id` for new manifests; old manifests keep verifying
under the public key that signed them, so archive each public key
(`GET /api/pipelines/manifest` returns the current one).

Verify a run offline: save the response of
`GET /api/pipelines/manifest?runId=<id>` to `manifest.json` (and the previous
run's to `previous.json` to check the chain link) and run:

```sh
node scripts/verify-pipeline-manifest.mjs manifest.json previous.json
```

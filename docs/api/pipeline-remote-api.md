# Remote jobs and lakehouse SQL API

Two pipeline steps reach outside the run's own database: a **remote job**
sends a script to an HPC queue and the run waits for it, and a **lakehouse**
step runs read-only SQL over the open tables. Their switches, the jobs a run
sent and their events are reachable with a token, from the assistant, over MCP,
in pipelines and through webhooks, the same way as the rest of the lab (see
[lab-api.md](lab-api.md) for scopes and how tokens work).

- Reads need `lab:read`; actions need `lab:write` and run as the person a
  **personal token** belongs to. The database makes the same checks as the
  app: the lakehouse switch needs data access (a data steward).
- Tables are read through `GET /api/db/<table>`; actions are
  `POST /api/db/rpc/<name>` with the `p_` arguments. Over MCP, actions run
  through `sheetbase.lab.act` and tables through `sheetbase.canonical.read`,
  under the workspace's agent permissions.
- Webhook events: `pipeline.remote_job.submitted`,
  `pipeline.remote_job.succeeded`, `pipeline.remote_job.failed` (all three can
  start a pipeline) and `pipeline.lakehouse_sql.updated`. See
  [event-catalogue.md](event-catalogue.md).
- A step is part of a pipeline version, so you add one with
  `create_pipeline_definition` or `update_pipeline_definition` (see
  [pipelines-api.md](pipelines-api.md)). The step shapes are below.

## The steps

A **remote job** step (`kind: "remote_job"`):

```json
{
  "name": "fit_titre_trend",
  "kind": "remote_job",
  "remoteJob": {
    "connection": "campus-hpc",
    "queue": "hpc-short",
    "script": "python fit.py",
    "limitMinutes": 20
  }
}
```

`connection` is the key of a remote job connection (below), `queue` one the
connection offers, `script` is bash, and `limitMinutes` (1 to 10080) is how long
the job may take: it is stopped and the run fails after that. The rows of the
step before it are what the job reads, and the table the job sends back is the
step's rows.

A **lakehouse** step (`kind: "lakehouse"`):

```json
{
  "name": "last_month",
  "kind": "lakehouse",
  "statement": "SELECT * FROM batches WHERE made_on > now() - interval '30 days'",
  "lake": { "tables": ["batches"] }
}
```

`lake.tables` names the open tables (1 to 10) the SQL reads, each as a table of
that name as it stands when the step starts. It is read only, up to 100,000
rows from each table, and stops at the same 60 seconds as any SQL step. It
needs the open tables on, the switch below on, and a run started by a person
with data access.

## Remote job connections

A connection is a connector (`register_connector`, `connector_type` `custom`)
with `adapter: "hpc"` in its settings:

```json
{
  "adapter": "hpc",
  "scheduler": "slurm",
  "baseUrl": "https://slurm.example.org:6820",
  "apiVersion": "v0.0.40",
  "user": "sheetbase",
  "queues": [{ "name": "hpc-short", "maxMinutes": 60 }, { "name": "bigmem" }],
  "callbackUrl": "https://eln.example.org"
}
```

Slurm (slurmrestd) is the scheduler it talks to today. The scheduler token is a
sealed secret of the connection, set in the app under Settings, Integrations,
and never returned or readable with a token. The connection lists the _names_ of
its secrets (`secrets`), never their values. A step names the one it uses:

```yaml
remote_job:
  {
    connection: campus-hpc,
    queue: hpc-short,
    secret: HPC_SUBMIT_KEY,
    limitMinutes: 20,
  }
```

`secret` is optional and defaults to `HPC_SUBMIT_KEY`, the same way a web call
step names its secret. A job keeps the name it was sent with (`secret_name` on
`pipeline_remote_jobs`) so a cancel or a sweep later uses the same secret. A
queue with `maxMinutes` refuses a step that asks for longer.

## How a job reaches Sheetbase

The job gets two addresses and a key in its environment, and uses plain HTTPS:

| Variable               | What it is                                                              |
| ---------------------- | ----------------------------------------------------------------------- |
| `SHEETBASE_INPUT_URL`  | `GET` it for `{ columns, rows }`, the rows of the step before.          |
| `SHEETBASE_RESULT_URL` | `POST` `{ "rows": [...] }` to finish, or `{ "error": "..." }` to fail.  |
| `SHEETBASE_JOB_TOKEN`  | Send as `Authorization: Bearer …`. Made for this job, it stops working. |

Any other call to either address answers 401, and one for a finished job
answers 409. An answer larger than a step may give back answers 413.

## Tables

| Table                  | What it holds                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pipeline_remote_jobs` | The jobs runs sent: connection, queue, cluster job id, state, why it failed, when it must finish and rows it gave back. |

`state` is `submitted`, `running`, `succeeded`, `failed` or `cancelled`.
`reason` is `job_failed`, `timed_out`, `no_result`, `cancelled` or
`submit_failed`. Cancelling the run (`cancel_pipeline_run`) stops the job.

## `pipeline_lakehouse_settings`

Whether pipeline steps may run SQL over the open tables.

| Argument         | Type | Notes          |
| ---------------- | ---- | -------------- |
| `p_workspace_id` | uuid | Your workspace |

Returns `{ enabled, lakeEnabled, tableCount }`: the steward's switch, whether
the open tables are on, and how many are ready to read.

## `set_pipeline_lakehouse_sql`

Turn lakehouse SQL steps on or off. Needs data access. Steps already saved stay
as they are and fail with a plain reason while it is off. Sends
`pipeline.lakehouse_sql.updated`.

| Argument         | Type    | Notes          |
| ---------------- | ------- | -------------- |
| `p_workspace_id` | uuid    | Your workspace |
| `p_enabled`      | boolean | On or off      |

Returns the same as `pipeline_lakehouse_settings`.

## What is not on the API

- The scheduler token and each job's key are secrets. They are set and used
  inside the app and the job, and no token can read or change them.

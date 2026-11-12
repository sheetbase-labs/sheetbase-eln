# Remote jobs and lakehouse SQL: running them

How the two outside-the-run pipeline steps are set up and what to check when
one stops. For the API see [../api/pipeline-remote-api.md](../api/pipeline-remote-api.md).

## Remote jobs on an HPC queue

1. A steward adds a connection under **Settings, Integrations, Pipeline
   connections** with type _HPC cluster_: a name, the scheduler address (slurmrestd), the cluster user,
   the queues (`hpc-short:60, gpu.a100:2880`, with the longest job each takes in
   minutes) and the scheduler token. The token is sealed on save and is never
   shown again.
2. The address must pass the same host policy as other outside addresses (no private
   or loopback addresses unless the install allows them).
3. Jobs reach Sheetbase at the app's own address. If the cluster reaches it
   another way, set **Address jobs call back on**.
4. A pipeline step picks the connection, a queue, a time limit and a script.

What happens at run time:

- The step sends the job and the run **waits**, as it does for a person. The
  worker is free; other runs go on.
- Every minute the scheduler sweep asks the cluster how each open job is doing.
  A job that finishes before its limit wakes the run. A job past its limit is
  cancelled on the cluster and the run fails with `timed_out`.
- The job reads its rows from `SHEETBASE_INPUT_URL` and sends its table to
  `SHEETBASE_RESULT_URL` with `SHEETBASE_JOB_TOKEN`. A job that ends without
  sending anything fails the run with `no_result`.
- A run that resumes finds its job by step name and never sends it twice.
  Cancelling the run cancels the job.

If a run is stuck waiting: read `pipeline_remote_jobs` for it. `submitted` with
no `external_job_id` means the scheduler refused it (`message` says why).
`running` past `deadline_at` means the sweep has not run; check the worker
logs.

## Lakehouse SQL

1. Turn on **open tables** under Settings, Open data.
2. A data steward turns on **Pipelines can read open tables with SQL** in the
   same page.
3. A step names the tables it reads. They are read as they stand when the step
   starts, from the current snapshot, and are tables of the step's SQL.

The step runs in the same sandbox as any SQL step (read only, 60 seconds). The
Parquet files are read by the app and loaded as temporary tables, so the
sandbox cannot reach the files or the catalogue. Up to 100,000 rows are read
from each table; more fails the step with a plain reason rather than cutting
rows off.

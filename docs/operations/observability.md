# Observability and troubleshooting

API-006 establishes the first layer of operational visibility: health probes,
request correlation, structured logging and stable public error categories.
PLAT-02 adds metrics, connector-run diagnostics, alert signals and the
tracing/SLO decisions. This document is the reference for all of it — what
the endpoints, metrics and log fields mean, and where to look when local
startup or authentication fails.

## Health endpoints

| Endpoint                | Purpose                                             | Dependencies probed                  | Status on failure                     |
| ----------------------- | --------------------------------------------------- | ------------------------------------ | ------------------------------------- |
| `GET /api/health/live`  | Liveness — the application process is running.      | none                                 | always 200 if the process can answer  |
| `GET /api/health/ready` | Readiness — the app and its dependencies can serve. | PostgreSQL, PostgREST admin `/ready` | 503 if either dependency is not ready |

`/ready` runs the database and PostgREST probes in parallel and reports each
dependency separately in the body:

```json
{
  "status": "ready",
  "artifact": { "version": "2026.07.26", "digest": "sha256:<digest>" },
  "database": {
    "ok": true,
    "latencyMs": 3,
    "migration": {
      "status": "compatible",
      "expected": "<journal-version>",
      "applied": "<journal-version>"
    }
  },
  "postgrest": { "ok": true, "latencyMs": 8 }
}
```

Staging and production set an expected migration version in the immutable
artifact contract. Readiness returns 503 when the latest applied Drizzle
migration differs, preventing traffic from reaching an incompatible database.
Development reports `not_checked` while using the explicit `untracked` default.

The `error` field is intentionally absent from the public body — connection
strings and hostnames can leak through raw driver errors, so the detail is
written to logs only. An operator reads the detail there, not from the probe
response.

Both endpoints honour the `x-request-id` header: if present and well-formed
(`[a-z0-9-]{1,128}`, case-insensitive) it is echoed back; otherwise a fresh
32-hex id is generated and stamped on the response.

## Request correlation

Every request through the same-origin data proxy (`/api/db/*`) carries a
correlation id:

1. Resolved from the incoming `x-request-id` header (or generated).
2. Forwarded to PostgREST as `x-request-id`, so upstream logs share the
   correlation.
3. Stamped on the response as `x-request-id`, so a user can quote it in a
   bug report.
4. Included in every structured log line for the request and in the
   `error.request_id` field of the public error envelope.

Connector runs add a second, durable identifier: `connector_run_id`. HTTP
requests that execute connector work log both ids (`request_id` for the
transport, `connector_run_id` for the durable run in `api.connector_runs`),
so a failed ingestion can be traced from a user's bug-report request id to
the run's logs, error code, attempt count and duration in the product run
history. Scientific content (sheet names, row values, payloads) is never
used as a correlation identifier.

## Metrics

`GET /api/metrics` serves the Prometheus text exposition format (version
0.0.4) from the in-process registry (`src/lib/metrics.ts`).

**Deployment access model.** The endpoint is never public. In staging and
production it requires `Authorization: Bearer $SHEETBASE_METRICS_TOKEN`
(injected by the secret manager), and the app container binds to loopback —
scrape over the private network (Tailscale/SSH tunnel or an in-VPS scraper).
With no token configured the endpoint answers 404: fail closed. In
development it is open on localhost for convenience.

### Metric catalogue

| Metric                                            | Type      | Labels (bounded)                                                                                                                 |
| ------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `sheetbase_http_requests_total`                   | counter   | `route` (db_proxy, files_upload, files_download, files_upload_authorize, health, metrics), `method`, `status`                    |
| `sheetbase_http_request_duration_seconds`         | histogram | `route`, `method`                                                                                                                |
| `sheetbase_db_upstream_requests_total`            | counter   | `category` (public error categories, `ok`)                                                                                       |
| `sheetbase_db_upstream_duration_seconds`          | histogram | `method`                                                                                                                         |
| `sheetbase_connector_runs_total`                  | counter   | `connector_type` (instrument, storage, webhook, database, custom), `outcome` (started, succeeded, failed, stale_reconciled)      |
| `sheetbase_connector_run_failures_total`          | counter   | `connector_type`, `error_code` (bounded set, else `other`)                                                                       |
| `sheetbase_connector_run_duration_seconds`        | histogram | `connector_type`, `outcome`                                                                                                      |
| `sheetbase_file_operations_total`                 | counter   | `operation` (upload, download), `outcome` (ok, oversize, checksum_mismatch, conflict, not_found, not_uploadable, missing, error) |
| `sheetbase_file_bytes_total`                      | counter   | `operation`                                                                                                                      |
| `sheetbase_file_operation_duration_seconds`       | histogram | `operation`                                                                                                                      |
| `sheetbase_dataset_rpc_duration_seconds`          | histogram | `operation` (query_dataset_rows, query_dataset_version_rows, commit_dataset_row_batch, snapshot_dataset, search, other)          |
| `sheetbase_dataset_commit_duration_seconds`       | histogram | `size_bucket` (small/medium/large/xlarge)                                                                                        |
| `sheetbase_dataset_snapshot_duration_seconds`     | histogram | `size_bucket`                                                                                                                    |
| `sheetbase_pipeline_stage_duration_seconds`       | histogram | `stage` (materialize_inputs, transform, output_commit, dataset_commit, dataset_snapshot, total)                                  |
| `sheetbase_pipeline_runs_total`                   | counter   | `trigger_kind` (manual/scheduled/event), `outcome` (succeeded/failed/cancelled)                                                  |
| `sheetbase_pipeline_active_runs`                  | gauge     | —                                                                                                                                |
| `sheetbase_scheduler_sweep_duration_seconds`      | histogram | —                                                                                                                                |
| `sheetbase_scheduler_due_occurrences_total`       | counter   | —                                                                                                                                |
| `sheetbase_scheduler_recovered_occurrences_total` | counter   | —                                                                                                                                |
| `sheetbase_scheduler_events_processed_total`      | counter   | —                                                                                                                                |
| `sheetbase_search_duration_seconds`               | histogram | —                                                                                                                                |
| `sheetbase_model_calls_total`                     | counter   | `model` (gateway allowlist, else `other`), `outcome` (ok, rejected, error)                                                       |
| `sheetbase_model_cost_microusd_total`             | counter   | `model`                                                                                                                          |
| `sheetbase_model_errors_total`                    | counter   | `model`, `code` (model_not_allowed, tool_not_allowed, actor_mismatch, budget_exhausted, provider_error)                          |
| `sheetbase_model_duration_seconds`                | histogram | `model`                                                                                                                          |

### Cardinality policy

Labels are bounded by construction. Every bounded label validates its values
against a declared set; an unknown value folds to `other` instead of creating
a new time series. Request IDs, run IDs, user IDs, workspace IDs, dataset
IDs, filenames and scientific values are **never** metric labels — they
belong in logs and the run history, correlated by id. Do not add new labels
without declaring their allowed values.

## Connector run diagnostics

Connector runs are the durable execution primitive (INT-01). For diagnosis:

- **Product run history** (`/integrations` → connector → runs) shows status,
  attempt lineage, duration, bounded error code and per-stage logs per run.
- **Structured logs** carry `connector_run_id`, `connector_type`, `attempt`,
  `duration_ms` and `error_code` on every start/succeed/fail event.
- **Metrics** (above) expose rates and durations without ids.
- **Retry attempts** are visible via `attempt` and `retry_of_run_id` on the
  run row.

### Stuck runs (reconciliation policy)

A run is request-scoped work in the app process. If a process dies mid-run,
the run would stay `running` forever, blocking its request digest (SB044)
and its selector identity (partial unique index). Policy: when a new attempt
starts for the same identity and the old run has been `running` longer than
the authoritative staleness threshold (a **fixed database policy, currently
900 s**, in `start_connector_run`), the RPC fails it with the bounded code
`stale_run_reconciled`, appends a `reconcile` warning to the run's durable
log, and links the new attempt as its retry. Runs inside the threshold still
conflict — legitimate in-flight work is never marked failed.

The threshold is deliberately **not caller input and not deployment
configuration**: the RPC is executable by any workspace writer, so a
caller-supplied threshold would let any member fail someone else's
in-flight run. Changing the threshold is a migration decision (or, later, a
controlled system configuration only privileged code can mutate). The
threshold is also the effective execution timeout for connector work —
revisit it via migration before running anything legitimately slower than
15 minutes. No second job system or scheduler is introduced.

## Alerts

`deploy/alerts.yml` is the initial machine-consumable alert set for any
Prometheus-compatible scraper. No alert-delivery platform exists in this
deployment yet — the rules and thresholds are the contract; wire a scraper
(load the rules file) when one is introduced. Initial signals:

| Alert                     | Signal                                                             | Severity |
| ------------------------- | ------------------------------------------------------------------ | -------- |
| Readiness failing         | `up == 0` for 5 m                                                  | critical |
| Server error rate         | > 2% of proxy requests for 10 m                                    | critical |
| Database unavailable      | sustained `service_unavailable` upstream failures                  | critical |
| Connector failure rate    | > 30% of finished runs over 30 m                                   | warning  |
| Stale-run reconciliations | any `stale_reconciled` outcome                                     | warning  |
| Backup missing            | no successful backup in 25 h (`latest.json` age / textfile metric) | critical |
| Restore drill failing     | last drill failed (textfile metric)                                | warning  |

The backup and restore-drill scripts emit optional Prometheus textfile
metrics (`SHEETBASE_METRICS_TEXTFILE_DIR`) so the backup alerts have a real
signal if a node_exporter-style textfile collector is present.

## Tracing decision

Distributed tracing is **deferred**. The deployment is a single app container
in front of one PostgREST and one PostgreSQL — there is no multi-hop fan-out
where trace context earns its operational cost. Request correlation
(`x-request-id` propagated app → PostgREST → logs), structured logs and the
metrics above already answer "what happened, where, how long". Revisit when
the topology genuinely fans out (e.g. AUTO workers, multiple app instances
behind different failure domains); if so, reuse `x-request-id` as the trace
id rather than introducing a second correlation id.

## SLO measurement plan

The roadmap sets SLOs **after usage data exists**. The metrics above already
make the future SLIs measurable:

| Future SLI                 | Measured by                                             | Data to collect                        |
| -------------------------- | ------------------------------------------------------- | -------------------------------------- |
| Availability               | successful readiness probes / total probes over window  | readiness probe history from a scraper |
| Request latency            | `sheetbase_http_request_duration_seconds` distributions | continuous scraping                    |
| Error rate                 | `sheetbase_http_requests_total` by status and category  | continuous scraping                    |
| Connector run success rate | `sheetbase_connector_runs_total` outcomes               | continuous scraping                    |

**Targets are deliberately deferred.** Set them when there is at least one
month of scraped history plus real usage evidence; inventing numbers now
would produce SLOs that are either trivially met or meaninglessly strict.

## Structured logging

The logger (`src/lib/logger.ts`) emits one JSON object per line. Info and
debug go to stdout; warn and error go to stderr, so operators can split
streams. Severity conventions:

| Level   | Use                                                                             |
| ------- | ------------------------------------------------------------------------------- |
| `debug` | Local dev only; never on in production.                                         |
| `info`  | Request lifecycle, successful operations.                                       |
| `warn`  | Recoverable problems — bad client input, rate limit hit, expected 4xx upstream. |
| `error` | Failures a developer must investigate — upstream 5xx, connection failure.       |

`LOG_LEVEL` selects the minimum severity emitted (default `info`).

### Redaction

Sensitive keys are recursively redacted before any field is logged:
`password`, `token`, `authorization`, `cookie`, `set-cookie`, `secret`,
`accessToken`, `refreshToken`, `idToken`, `pgrst_jwt_secret`,
`better_auth_secret`, `github_client_secret`, `postgres_password`. The check
is case-insensitive and recurses into nested objects and arrays. Formula
contents and scientific payloads are never logged by the proxy: it logs only
the validated resource name (e.g. `projects` or `rpc/create_project`), the
HTTP method, the status, the duration and the request id — never the query
string, body, headers or row filters.

When in doubt, log less, not more.

## Stable public error categories

Proxy failures and upstream PostgREST errors are returned as:

```json
{ "error": { "category": "conflict", "message": "...", "request_id": "..." } }
```

Clients should branch on `category`, never on string messages or
PostgREST-internal codes. The category set:

| Category              | HTTP | Meaning                                            |
| --------------------- | ---- | -------------------------------------------------- |
| `validation_error`    | 400  | Bad input, constraint check, malformed path.       |
| `unauthenticated`     | 401  | No valid session or credential.                    |
| `permission_denied`   | 403  | RLS, scope, or no active workspace.                |
| `not_found`           | 404  | Resource does not exist.                           |
| `conflict`            | 409  | Unique violation, serialization failure, deadlock. |
| `rate_limited`        | 429  | Too many attempts.                                 |
| `service_unavailable` | 500+ | Upstream down or schema not loaded.                |
| `server_error`        | 500  | Unclassified — a developer must investigate.       |

PostgREST error `details` and `hint` fields are dropped before the public
envelope is built because they can leak schema internals; the `message` is
preserved when present because it is intended for clients.

## Troubleshooting common local failures

### `pnpm dev` starts but `/api/health/ready` returns 503

- Check the response body: it names which dependency is `not_ready`.
- **Database `not_ready`:** is PostgreSQL running? `pg_isready -h localhost -p
5432 -U sheetbase`. Does `DATABASE_URL` in `.env.local` point at the right
  database and role? Has the migration set been applied (`pnpm db:migrate`)?
- **PostgREST `not_ready`:** is the PostgREST container running
  (`docker compose ps postgrest`)? Is `POSTGREST_ADMIN_URL` correct
  (default `http://localhost:3002`)? PostgREST will not become ready until
  PostgreSQL is ready and the `api` schema is loaded, so fix the database
  first.

### `/api/db/projects` returns `unauthenticated`

- The same-origin proxy requires a Better Auth browser session. Sign in at
  `/` first. If sign-in loops, see `docs/operations/authentication.md`.
- The external bearer-token path (API-005) is separate; do not send an
  `Authorization: Bearer ...` token to `/api/db` expecting the browser
  session to be bypassed.

### `/api/db/projects` returns `permission_denied` with `no_workspace`

- The signed-in user has no workspace membership. The first sign-up should
  bootstrap one (AUTH-002); if it did not, check the auth callback logs and
  the `workspace_memberships` table.

### A 4xx user error appears in logs as `error` level

- It should not. Expected 4xx (validation, permission, conflict, not found,
  rate limited) are logged at `warn`; only 5xx is `error`. If you see a 4xx
  at `error` level, the proxy's `categorisePostgrestError` mapping is
  probably missing a SQLSTATE — add it in `src/lib/errors.ts` and add a
  test.

### Logs contain a value that looks like a secret

- It should not. Add the key to `REDACTED_KEYS` in `src/lib/logger.ts` and
  add a redaction test. Never log raw request bodies, query strings, cookies
  or authorization headers — the proxy deliberately logs only safe
  resource labels.

CSP and related browser security headers are documented in
`docs/operations/security-headers.md`.

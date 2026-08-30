# Integrations — Connector Framework (INT-01 / INT-02 / INT-03)

Sheetbase has **one** generic connector framework. Every integration uses the
same execution, security, mapping, provenance and error model. Scientific
instrument connectors use it today. Enterprise and data-platform connectors
use it alongside them. There is no second path and no per-instrument
bespoke subsystem.

## Shape

```text
external source
   ↓
Connector            api.connectors        identity/type/direction/config
   ↓
Run                  api.connector_runs    trigger · attempt · digest · error
   ↓
raw file             retained FIRST via the canonical file platform
   ↓                     (fileRecordId + sha256 receipt)
parse                registered parser (parserId@version)
   ↓
map                  column mapping onto pinned Schema Version fields
   ↓
required coverage    required Schema fields must be mapped (pre-create)
   ↓
target Dataset       created only after parse+mapping+coverage succeed
   ↓
validate             api.validate_dataset_row_batch  (canonical, fail-closed)
   ↓
commit               api.commit_dataset_row_batch    (idempotent receipt)
   ↓
provenance + history run result jsonb · connector_run_logs · change_events
```

## Framework contract

### Connector registry (`api.connectors`)

| Field            | Notes                                                       |
| ---------------- | ----------------------------------------------------------- |
| `key`            | workspace-unique slug, immutable (`^[a-z][a-z0-9-]{0,48}$`) |
| `connector_type` | `instrument`, `storage`, `webhook`, `database`, `custom`    |
| `direction`      | `inbound`, `outbound`, `bidirectional`                      |
| `status`         | `active`, `paused`, `archived`                              |
| `parser_id`      | registered ingestion parser identity (instrument type only) |
| `config`         | **non-secret settings only**                                |

Registration and pausing require the `integrations.manage` capability
(owner / admin / steward). Register a connector with `api.register_connector`;
pause it with `api.update_connector`. Capability resolution lives only in SQL
`api.has_capability` and its UI mirror `src/lib/capability.ts`.

### Runs (`api.connector_runs`)

One row per execution. Rows are written exclusively through RPCs. The tables
carry **SELECT-only grants** for request roles, so run lifecycle cannot be
fabricated by direct writes:

- `api.start_connector_run(workspace_id, connector_id, trigger_kind,
request_digest, retry_of_run_id)` — actor is the session user XOR the
  service credential (same convention as `dataset_bulk_commits`).
- `api.complete_connector_run(workspace_id, run_id, result)` /
  `api.fail_connector_run(workspace_id, run_id, error_code, error_message)`.
- `api.append_connector_run_log(...)` appends an observability line to
  `api.connector_run_logs` with a per-run monotonic sequence.

Properties:

- **Triggers:** `manual`, `scheduled`, `event` (scheduling and event delivery
  themselves arrive with AUTO/API webhooks — the vocabulary is already durable).
- **Idempotency:** `request_digest` is the sha256 of the request identity —
  actual payload content hash (never byte length), parser identity, target
  Dataset/Schema and mapping configuration. Only **successful** runs are
  unique receipts for a digest.
- **Replay:** re-submitting a successful request returns the stored prior run
  and its result payload. It never returns an empty "0 rows" success.
- **Retries:** a **failed** run is retried explicitly:
  `start_connector_run(..., retry_of_run_id = failed run)` creates a new
  attempt (+1) under the same request identity. Retrying a failed digest
  without the link is refused, so failures cannot be silently hidden. The
  product flow uses this automatically: re-submitting a failed ingestion
  detects the failed matching request and retries against it as a linked
  attempt. There is no dead-end and no unlinked duplicate.
- **Errors:** bounded `error_code` recorded on failure (`parse_failed`,
  `no_mapping`, `mapping_failed`, `required_mapping`, `commit_failed`,
  validation codes ...).
- **Provenance:** successful runs store a result jsonb. Instrument ingestion
  records dataset id/revision, schema version, canonical file record id,
  file sha256, size, parser identity and extracted instrument metadata.

Runs emit `change_events` (`entity_type = 'connector'` / `'connector_run'`),
so audit/history surfaces show connector lifecycle without extra wiring.

### Secrets

Third-party credentials are **never** stored in connector config or any JSON a
client can read. They live in `internal.connector_secrets` as AES-256-GCM
ciphertext sealed server-side (`src/lib/connector-secrets.server.ts`). Only
stewards can set, rotate or delete them through server functions. Plaintext is
never returned to any caller. PostgREST cannot see the table at all.
Composite foreign keys (`workspace_id, connector_id`) across runs, logs and
secrets make cross-workspace attachment impossible at the storage layer.

## SDK surface (`src/lib/connectors/`)

- `types.ts` — wire shapes for connectors, runs and logs.
- `registry.ts` — connector type catalogue and parser registry. A parser is
  pure text → `{ metadata, headers, rows, warnings }` identified by
  `parserId@version`.
- `client.ts` — typed DataClient calls to every connector RPC and resource
  read.
- `run.ts` — `executeConnectorRun()`: wraps any unit of work in the governed
  execution model (start → stage logs → complete/fail), including failures.
- `dataset-writes.ts` — the single seam to `validate_/commit_dataset_row_batch`.
  Connectors must not bypass canonical Dataset validation.
- `plate-reader.ts` — representative parser: metadata header lines
  (`# Key: value`) followed by a CSV table. Unknown values stay blank so the
  Schema Version's fail-closed coercion decides validity.
- `instrument-ingestion.ts` — end-to-end instrument ingestion orchestration
  used by the `/integrations/$connectorId` ingest panel.

Future integrations implement (a) a parser or data plane adapter registered in
`registry.ts` and (b) optionally new non-secret config keys. They inherit runs,
retries, errors, secrets, capability gating, change events and provenance
without inventing anything.

## Enterprise connectors (INT-03)

INT-03 proves the same framework carries enterprise and data-platform sources:
a generic **S3-compatible object storage** connector and a generic **read-only
external PostgreSQL** connector. Both dispatch through `config.adapter`
(`'s3'` for `storage` connectors, `'postgres'` for `database` connectors) and
reuse everything above — runs, digests, retries, sealed secrets, change
events — via a small **server-side adapter layer** in
`src/lib/connectors/enterprise/`:

| Module                  | Role                                                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapter.ts`            | `EnterpriseConnectorAdapter` seam: `testConnection`, `discover`, `preview`, `ingest`. Vendor code stays inside each adapter.                                                                                                                                                          |
| `execution.server.ts`   | Server-only execution boundary: session/role resolution (viewers refused; mirrors `is_workspace_writer`), short-lived PostgREST token, server-side `DataClient` so every write still goes through governed RPCs.                                                                      |
| `secrets.server.ts`     | Execution-time sealed-secret decryption (workspace↔connector verified server-side) + `redactSecrets` so plaintext never reaches run results, logs or audit.                                                                                                                           |
| `host-policy.server.ts` | Connector destination policy: only http(s) endpoints, no credential-bearing URLs, no `file://`; optional `CONNECTOR_HOST_ALLOWLIST`; `CONNECTOR_ALLOW_PRIVATE_HOSTS` (default **true** — Sheetbase targets on-prem networks, and this switch is policy only, not network isolation).  |
| `retain.server.ts`      | Server-side retention of external bytes through the canonical DATA-03 file platform (`create_file_upload` → object storage → `finalize_file_upload`), so provenance carries a real `fileRecordId` + sha256.                                                                           |
| `s3.server.ts`          | S3-compatible adapter: `HeadBucket` test, paginated `ListObjectsV2` discovery (prefix-filtered, ETag as opaque metadata), **streamed** `GetObject` with an enforced byte cap (read aborted at the cap, `ContentLength` pre-check), delimited parser identity `sheetbase.delimited@1`. |
| `postgres.server.ts`    | Read-only PostgreSQL adapter: connection test, `information_schema` discovery (system schemas hidden, `allowedSchemas`/`allowedTables` respected), explicit-column `LIMIT n` preview/import with validated + quoted identifiers, `row_limit_exceeded` caps.                           |

### Execution shape

Browser → `POST /api/connectors/source` (`test` | `discover` | `preview` |
`import`) → server-side adapter. The browser never touches the external
system and never receives decrypted credentials.

The governed run starts **before** any external source work. Connection,
authentication, download/query and limit failures are then recorded as
**failed runs** with bounded error codes. Two request identities cooperate:

- `selector_digest` (provisional, known up-front: connector + selector +
  parser + target + mapping) — guards concurrent duplicate attempts and
  carries retry lineage for failed attempts.
- `request_digest` (canonical, content-aware: everything above **plus the
  read/retained content sha256**) — established inside the running attempt,
  before retention or commit, via `api.establish_connector_run_request`
  (migration 0137).

Consequences, all proven by test:

- a changed external source under the same key/table is a **new logical
  request** (new content digest);
- an identical source **replays the prior successful result**. The attempt
  succeeds with `replayOfRunId` provenance and does **not** retain a
  duplicate file or commit duplicate rows;
- a failed attempt retries as an explicitly linked new attempt (INT-01
  SB045 semantics, resolved up-front via the selector identity).

### Provenance

- **S3 runs** record `kind: 's3_import'`, source `{bucket, key, versionId,
etag, lastModified}`, retained file `fileRecordId` + `fileSha256`, parser
  identity and the resulting Dataset/revision.
- **PostgreSQL runs** record `kind: 'postgres_import'`, source
  `{host, port, database, schema, table, columns, contentSha256}` (no
  credentials — the host identity is credential-free), read timestamp
  implied by the run's `started_at`, mapping identity and the resulting
  Dataset. Database imports have no raw retained file by design. The read
  content hash is the evidence that the import matches a specific source
  state. No transactionally frozen source state is claimed. A repeatable-
  read snapshot is _not_ guaranteed.

### Limits (per release)

Preview ≤ 100 rows (config `preview_rows`), import ≤ 1000 rows (config
`import_rows`, aligned with the DATA parse layer's sheet cap), object
downloads ≤ 100 MiB (config `max_object_bytes`). A run that exceeds a row
cap fails with `row_limit_exceeded`. It does not truncate silently.

### Run UX

Connector detail shows per-adapter **Source** panels (discovery, bounded
preview, import target), a steward-only **Credentials** card (names and
timestamps only — values are set/rotated/deleted, never readable) and the
shared run history with semantic result lines. Raw result JSON stays behind
a technical disclosure.

### Boundaries (enterprise)

- Strictly read-only PostgreSQL source: no arbitrary SQL, DML, DDL or
  stored-procedure execution. The only statements issued are catalog
  metadata queries and a generated, quoted `SELECT … LIMIT n`.
- Enterprise imports never write Dataset rows directly. They reuse the same
  `ingestTabularPayload` primitive as instrument ingestion.
- No second integration framework, audit system or connector registry.

Out of scope remains: Snowflake/Databricks/BigQuery, SharePoint/OneDrive,
LIMS/MES/ERP, CDC, schedulers and any write-path to external systems.

## Product surface

`/integrations` lists the workspace's connectors; `/integrations/$connectorId`
shows configuration, the **ingest panel** (instrument connectors) and full run
history with expandable per-run stage logs and result provenance payloads.

## Boundaries

- The RPC layer is the only mutation surface for connector lifecycle rows.
  Request roles hold SELECT-only grants on connectors, runs and logs, so the
  capability gates, idempotency and attempt semantics cannot be bypassed and
  lifecycle audit events cannot be fabricated.
- Raw source files are retained through the canonical DATA-03 file platform
  **before** the run starts. Run provenance always carries the canonical
  fileId and sha256 for the instrument flow.
- Connectors never bypass canonical Dataset/Record validation. Row writes go
  only through the Core batch RPCs inside the run.
- A new target Dataset is created only after parse, mapping coercion and the
  required-field coverage check succeed. The coverage check mirrors the Core
  RPC's `required_value` rule over the same pinned Schema metadata. A mapped
  but schema-invalid payload therefore fails the run with **zero** Datasets
  created.
- Credentials live in sealed secrets, not configuration JSON exposed to clients.

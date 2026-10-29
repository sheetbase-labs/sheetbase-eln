# Integrations — Connector Framework (INT-01 / INT-02 / INT-03)

Sheetbase has **one** generic connector framework. Every integration — scientific
instrument today, enterprise/data-platform connectors alongside them — uses the
same execution, security, mapping, provenance and error model. There is no second
path and no per-instrument bespoke subsystem.

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
(owner / admin / steward). Registration is done via `api.register_connector`;
pausing via `api.update_connector`. Capability resolution lives only in SQL
`api.has_capability` and its UI mirror `src/lib/capability.ts`.

### Runs (`api.connector_runs`)

One row per execution. Written exclusively through RPCs — the tables carry
**SELECT-only grants** for request roles, so run lifecycle cannot be fabricated
by direct writes:

- `api.start_connector_run(workspace_id, connector_id, trigger_kind,
request_digest, retry_of_run_id)` — actor is the session user XOR the
  service credential (same convention as `dataset_bulk_commits`).
- `api.complete_connector_run(workspace_id, run_id, result)` /
  `api.fail_connector_run(workspace_id, run_id, error_code, error_message)`.
- `api.append_connector_run_log(...)` appends an observability line to
  `api.connector_run_logs` with a per-run monotonic sequence.

Properties:

- **Triggers:** `manual`, `scheduled`, `event` (scheduling/event delivery itself
  arrives with AUTO/API webhooks — the vocabulary is already durable).
- **Idempotency:** `request_digest` is the sha256 of the request identity —
  actual payload content hash (never byte length), parser identity, target
  Dataset/Schema and mapping configuration. Only **successful** runs are
  unique receipts for a digest.
- **Replay:** re-submitting a successful request returns the stored prior run
  and its result payload — never an empty "0 rows" success.
- **Retries:** a **failed** run is retried explicitly:
  `start_connector_run(..., retry_of_run_id = failed run)` creates a new
  attempt (+1) under the same request identity. Retrying a failed digest
  without the link is refused, so failures cannot be silently hidden. The
  product flow uses this automatically: re-submitting a failed ingestion
  detects the failed matching request and retries against it as a linked
  attempt — no dead-end, no unlinked duplicate.
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
stewards can set, rotate or delete them through server functions; plaintext is
never returned to any caller; PostgREST cannot see the table at all.
Composite foreign keys (`workspace_id, connector_id`) across runs, logs and
secrets make cross-workspace attachment impossible at the storage layer.

## SDK surface (`src/lib/connectors/`)

- `types.ts` — wire shapes for connectors, runs and logs.
- `registry.ts` — connector type catalogue + parser registry. A parser is pure
  text → `{ metadata, headers, rows, warnings }` identified by
  `parserId@version`.
- `client.ts` — typed DataClient calls to every connector RPC + resource reads.
- `run.ts` — `executeConnectorRun()`: wraps any unit of work in the governed
  execution model (start → stage logs → complete/fail), including failures.
- `dataset-writes.ts` — the single seam to `validate_/commit_dataset_row_batch`;
  connectors must not bypass canonical Dataset validation.
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

INT-03 proves the same framework carries enterprise/data-platform sources: a
generic **S3-compatible object storage** connector and a generic **read-only
external PostgreSQL** connector. Both dispatch through `config.adapter`
(`'s3'` for `storage` connectors, `'postgres'` for `database` connectors) and
reuse everything above — runs, digests, retries, sealed secrets, change
events — via a small **server-side adapter layer** in
`src/lib/connectors/enterprise/`:

| Module                  | Role                                                                                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapter.ts`            | `EnterpriseConnectorAdapter` seam: `testConnection`, `discover`, `preview`, `ingest`. Vendor code stays inside each adapter.                                                                                                                                                                      |
| `execution.server.ts`   | Server-only execution boundary: session/role resolution (viewers refused; mirrors `is_workspace_writer`), short-lived PostgREST token, server-side `DataClient` so every write still goes through governed RPCs.                                                                                  |
| `secrets.server.ts`     | Execution-time sealed-secret decryption (workspace↔connector verified server-side) + `redactSecrets` so plaintext never reaches run results, logs or audit.                                                                                                                                       |
| `host-policy.server.ts` | Connector destination policy: only http(s) endpoints, no credential-bearing URLs, no `file://`; optional `CONNECTOR_HOST_ALLOWLIST`; `CONNECTOR_ALLOW_PRIVATE_HOSTS` (default **true** — Sheetbase legitimately targets on-prem networks, and this switch is policy only, not network isolation). |
| `retain.server.ts`      | Server-side retention of external bytes through the canonical DATA-03 file platform (`create_file_upload` → object storage → `finalize_file_upload`), so provenance carries a real `fileRecordId` + sha256.                                                                                       |
| `s3.server.ts`          | S3-compatible adapter: `HeadBucket` test, paginated `ListObjectsV2` discovery (prefix-filtered, ETag as opaque metadata), **streamed** `GetObject` with an enforced byte cap (read aborted at the cap, `ContentLength` pre-check), delimited parser identity `sheetbase.delimited@1`.             |
| `postgres.server.ts`    | Read-only PostgreSQL adapter: connection test, `information_schema` discovery (system schemas hidden, `allowedSchemas`/`allowedTables` respected), explicit-column `LIMIT n` preview/import with validated + quoted identifiers, `row_limit_exceeded` caps.                                       |

### Execution shape

Browser → `POST /api/connectors/source` (`test` | `discover` | `preview` |
`import`) → server-side adapter. The browser never touches the external
system and never receives decrypted credentials.

The governed run starts **before** any external source work, so connection,
authentication, download/query and limit failures are recorded as **failed
runs** with bounded error codes. Two request identities cooperate:

- `selector_digest` (provisional, known up-front: connector + selector +
  parser + target + mapping) — guards concurrent duplicate attempts and
  carries retry lineage for failed attempts;
- `request_digest` (canonical, content-aware: everything above **plus the
  read/retained content sha256**) — established inside the running attempt,
  before retention or commit, via `api.establish_connector_run_request`
  (migration 0137).

Consequences, all proven by test:

- a changed external source under the same key/table is a **new logical
  request** (new content digest);
- an identical source **replays the prior successful result** — the attempt
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
  Dataset. Database imports have no raw retained file by design; the read
  content hash is the evidence that the import matches a specific source
  state. No transactionally frozen source state is claimed — a repeatable-
  read snapshot is _not_ guaranteed.

### Limits (conservative, per release)

Preview ≤ 100 rows (config `preview_rows`), import ≤ 1000 rows (config
`import_rows`, aligned with the DATA parse layer's sheet cap), object
downloads ≤ 100 MiB (config `max_object_bytes`). Exceeding a row cap fails
the run with `row_limit_exceeded` rather than silently truncating.

### Run UX

Connector detail shows per-adapter **Source** panels (discovery, bounded
preview, import target), a steward-only **Credentials** card (names and
timestamps only — values are set/rotated/deleted, never readable) and the
shared run history with semantic result lines; raw result JSON stays behind
a technical disclosure.

### Boundaries honoured (enterprise)

- Strictly read-only PostgreSQL source: no arbitrary SQL, DML, DDL or
  stored-procedure execution — the only statements issued are catalog
  metadata queries and a generated, quoted `SELECT … LIMIT n`.
- Enterprise imports never write Dataset rows directly; they reuse the same
  `ingestTabularPayload` primitive as instrument ingestion.
- No second integration framework, audit system or connector registry.

Out of scope remains: Snowflake/Databricks/BigQuery, SharePoint/OneDrive,
LIMS/MES/ERP, CDC, schedulers and any write-path to external systems.

## Instrument file pickup and parsers (INT-02)

Result files on the computer attached to an instrument reach the ELN without
anyone uploading them by hand.

```
results folder → scripts/instrument-agent.mjs → POST /api/connectors/pickup
  → connector (type instrument, active) → raw file retained (file platform)
  → parser → mapping → Dataset → connector run → instrument run + raw file
```

**Endpoint.** `POST /api/connectors/pickup?connector=<key>&fileName=<name>[&parser=<id>]`
with the raw file as the body. Auth is `Authorization: Bearer <token>` where the
token is the short-lived result of exchanging a **personal** API token at
`/api/token` with scopes `files:write` and `datasets:write`. Personal tokens
carry the creating member's identity, so RLS, viewer read-only and attribution
match that person working in the app; revoking the token or the membership stops
the agent. Service (`api_client`) credentials are refused with
`personal_token_required`: the file and Dataset write RPCs are not granted to
that role. Files are capped at 25 MiB and must be text; binary files are
rejected with `unsupported_format` before anything is retained.

**Where files go** is the connector's `config.pickup`, set from the instrument's
_Set up data intake_ (or on the connector page under _Folder pickup_):

| Key                          | Meaning                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `projectId` (required)       | Project that holds the retained raw file record.                                                                  |
| `schemaVersionId` (required) | Published Dataset Schema Version rows are mapped to.                                                              |
| `datasetId`                  | Append every file to this Dataset. Omit for a new Dataset per file.                                               |
| `datasetNamePattern`         | Name of each new Dataset; `{connector}`, `{file}`, `{date}` are filled in.                                        |
| `autoDetect`                 | Detect the format from content instead of using the connector's parser.                                           |
| `instrumentId`               | Also record a completed instrument run holding the raw file (best effort; the response reports `instrumentLink`). |

Responses: `201` for a new run, `200` when the same file content was already
ingested (the run is replayed, not duplicated), and an error envelope otherwise.
`4xx` other than `408/409/425/429` are permanent for that file; `5xx`, `429`
and `409` (for example a stale Dataset revision when several files append to one
Dataset) are worth retrying.

**Agent.** `scripts/instrument-agent.mjs` is dependency-free Node 22. It sends a
file once its size and modified time have stopped changing, moves sent files to
`processed/`, moves refused files to `failed/` with a `.error.txt` beside them,
and leaves anything retryable in place with back-off. Its settings (`url`,
`connector`, `dir`, `credential`) come from `sheetbase-agent.json` beside the
script, then the environment, then flags. The credential is only ever sent to
`/api/token`. Each pass signs in again when its short-lived token is about to
lapse, so an idle agent still shows as running.

**Guided setup and download.** On an instrument's page, _Set up data intake_
(`IntakeSetupDialog`) asks how files are read (worked out per file, or one
parser, with a sample-file preview), where they go (a project the person can
edit, a dataset structure, an existing or new dataset per file) and then offers
the agent. Saving makes or updates the instrument's own connector
(`saveIntakeSetup`: key from the instrument's name and display id, `config.pickup`
including `instrumentId`, `parser_id`); `api.update_connector` takes `p_parser_id`
or `p_clear_parser` for changes. Nobody types a connector key, UUID or token.

`POST /api/connectors/agent` `{ connectorId, system, folder }` (signed in, needs
`integrations.manage`) returns `sheetbase-agent.zip`: the agent, the settings
file, a start file for Windows, Mac or Linux, and a read-me. It makes a personal
token named `Folder agent · <connector key>` with `files:write` and
`datasets:write` and revokes any earlier one with that name, so only the newest
download works. `GET /api/connectors/agent?connector=<id>` returns
`{ downloaded, lastSeenAt, running }`, read from that token's last-used time
(running = signed in within 20 minutes). The token acts as the person who
downloaded it, so the setup only offers projects they can edit.

**Parsers** (all pure text → table, identity stamped as `parserId@version`):

| Parser                         | Reads                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `sheetbase.plate-reader-csv@1` | `# Key: value` header block, then a table.                                             |
| `sheetbase.plate-grid-csv@1`   | Plate matrix (A–H × 1–12); one row per read well; several blocks add a `Plate` column. |
| `sheetbase.qpcr-results-csv@1` | `[Results]` section (or a bare Well + Ct/Cq table) with `* Key = value` preamble.      |
| `sheetbase.hplc-peaks-csv@1`   | `Key,Value` preamble then a retention-time/area peak table.                            |
| `sheetbase.json-records@1`     | Array of row objects, or `{ metadata, rows }`.                                         |
| `sheetbase.delimited@1`        | Plain CSV/TSV (fallback).                                                              |

`detectParserId()` chooses between them from content; the identity actually used
is recorded in the run, so a wrong guess is visible. Binary vendor formats
(Excel, vendor-native) are not parsed: export the run as CSV, TSV or JSON.

### One parser model (migration 0033)

Every route that reads an instrument file — the connector's upload panel,
`POST /api/connectors/pickup` (folder agent) and `POST /api/connectors/intake`
(upload and "Try again") — goes through `runIntake` and resolves its parser from
`api.parsers` / `api.parser_versions`. Nothing registers a silent draft any
more. The built-ins above are seeded into every workspace as **approved**
versions (`api.ensure_builtin_parsers`). Approval is required only where the data
is regulated: `api.commit_dataset_import` refuses a parser version that isn't
approved when the Dataset's intended use is `regulated_record` (`SB107`). For
other data, intake reads with the newest approved version of the parser, or the
newest unretired one when none is approved.

Parser kinds, told apart by the version's `signature`:

| Kind     | Signature                                 | Reads with                               |
| -------- | ----------------------------------------- | ---------------------------------------- |
| Built in | `engine: "key@version"` or a built-in key | the code parser                          |
| Columns  | `requiredHeaders: [...]`                  | a delimited table that has those columns |
| Layout   | `requiredHeaders` plus `layout: {...}`    | a text file read as the layout describes |
| Webhook  | `webhook: { url }`                        | a service you host, called with the file |

**Layouts (no code).** A columns parser can carry a `layout` so a new file
format needs no release (`src/lib/import/parser-layout.ts`, one pure reader shared
by the browser preview, the Import page, the folder agent and the test-file
check). Options: `delimiter`, `headerStartsWith` or `headerLine` (where the
table starts), `readDetails` (`Key: value` lines above the table become file
details), `ignoreLines` (prefixes), `stopAt` (a footer), `units` (`header` for
`Conc (mg/mL)`, or `row` for a row under the names; kept as `<column> unit`
details), `decimalComma`, and `plateGrid` (`{ valueName }`: a grid of columns
1, 2, 3… by rows A, B, C… becomes one row per well). `requiredHeaders` are then
checked against the columns the layout produces. Text files only; spreadsheets
and anything stranger use a webhook parser. The editor under Settings, parsers
shows a sample file as each option changes.

**Webhook parsers.** The ELN `POST`s the raw file to the parser's address.
Headers: `X-Sheetbase-File-Name` (URL-encoded), `X-Sheetbase-Parser`
(`key@version`), `X-Sheetbase-Timestamp` and `X-Sheetbase-Signature`
(`sha256=` + hex HMAC-SHA256 of `"<timestamp>."` and the body, keyed with the
parser's signing key). The service answers `200` with
`{ headers, rows, metadata, warnings }`, or a `4xx` with
`{ error: { code, message } }`; the message is shown to the scientist. The ELN
refuses redirects, waits 30 seconds, caps the answer at 50 MB and checks the
address against the same host policy as other outbound connectors. The signing
key is sealed in `internal.parser_webhook_secrets`, shown once when the parser
is made (`POST /api/parsers/webhook`, actions `create` and `rotate`), and a
webhook parser is tested and approved like any other. The Python helper is
`sheetbase.parsers` (`sheetbase parser serve parser.py` and `sheetbase parser test parser.py sample.csv`).

**Intake problems.** A file that can't be read leaves a row in
`api.intake_failures` (file, reason, source, attempts), de-duplicated by
connector and checksum while open. Unreadable files are always kept. Settings and
the instrument and connector pages list them with _Try again_, _Use a different
parser_ and _Dismiss_; reading the same file later closes the problem. The
folder agent moves a file to `failed/` only for permanent causes; an unreachable
or slow webhook service answers `502` so the file is retried.

## Product surface

`/integrations` lists the workspace's connectors; `/integrations/$connectorId`
shows configuration, the **ingest panel** (instrument connectors) and full run
history with expandable per-run stage logs and result provenance payloads.

## Boundaries honoured

- The RPC layer is the only mutation surface for connector lifecycle rows —
  request roles hold SELECT-only grants on connectors, runs and logs, so the
  capability gates, idempotency and attempt semantics cannot be bypassed and
  lifecycle audit events cannot be fabricated.
- Raw source files are retained through the canonical DATA-03 file platform
  **before** the run starts; run provenance always carries the canonical
  fileId and sha256 for the instrument flow.
- Connectors never bypass canonical Dataset/Record validation — row writes go
  only through the Core batch RPCs inside the run.
- A new target Dataset is created only after parse, mapping coercion and the
  required-field coverage check (mirroring the Core RPC's `required_value`
  rule over the same pinned Schema metadata) have succeeded — so a mapped but
  schema-invalid payload fails the run with **zero** Datasets created.
- Credentials live in sealed secrets, not configuration JSON exposed to clients.

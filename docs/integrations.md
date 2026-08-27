# Integrations — Connector Framework (INT-01 / INT-02)

Sheetbase has **one** generic connector framework. Every integration — scientific
instrument today, enterprise platforms later — uses the same execution,
security, mapping, provenance and error model. There is no second path and no
per-instrument bespoke subsystem.

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

| Field | Notes |
| --- | --- |
| `key` | workspace-unique slug, immutable (`^[a-z][a-z0-9-]{0,48}$`) |
| `connector_type` | `instrument`, `storage`, `webhook`, `database`, `custom` |
| `direction` | `inbound`, `outbound`, `bidirectional` |
| `status` | `active`, `paused`, `archived` |
| `parser_id` | registered ingestion parser identity (instrument type only) |
| `config` | **non-secret settings only** |

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

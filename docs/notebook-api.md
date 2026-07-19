# Notebook API (ELN-003)

The notebook domain is exposed through PostgREST at the same-origin `/api/db`
boundary the browser already uses for projects. Direct CRUD on the notebook
tables is safe under RLS for straightforward reads and writes; controlled
RPCs handle multi-row operations and optimistic-concurrency checks. The
browser never talks to PostgREST directly — `src/lib/data-client.ts` is the
single client surface.

Decision record 0015 fixes the vocabulary; `docs/database-access.md` covers
the RLS shape; this document maps notebook operations to HTTP.

## Resources

| Resource       | Shape                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `folders`      | folder hierarchy under a project. `GET`, `POST`, `PATCH`, `DELETE` (owner).                                            |
| `records`      | notebook-backed records (experiment / protocol_template / report). `GET`, `POST` (via RPC), `PATCH`, `DELETE` (owner). |
| `blocks`       | ordered typed content of a record. `GET`, `POST`, `PATCH` (via RPC for version safety), `DELETE`.                      |
| `record_links` | typed links from a record to another record or external object. `GET`, `POST` (via RPC), `PATCH`, `DELETE`.            |
| `revisions`    | immutable snapshots. `GET`, `POST` only — UPDATE/DELETE are not granted.                                               |

## RPCs

All RPCs are `POST /api/db/rpc/<name>` with a JSON body. Each runs as
`SECURITY INVOKER`, so the writes inside are still subject to RLS (defence in
depth). The browser calls them through `dataClient.rpc(name, args)`.

### `create_record_with_blocks`

Creates a record and its initial blocks in one transaction. Reuses
`create_record` for the stable `EXP-`/`PRT-`/`RPT-YYYY-NNNN` identifier.

```jsonc
// POST /api/db/rpc/create_record_with_blocks
{
  "p_project_id": "00000000-0000-4000-8000-000000000100",
  "p_kind": "experiment",
  "p_title": "Virus Stability at 4C",
  "p_status": "draft",
  "p_tags": ["stability", "qPCR"],
  "p_blocks": [
    {
      "type": "heading",
      "payload": { "level": 1, "text": "Virus Stability" },
      "order": 1,
    },
    {
      "type": "rich_text",
      "payload": { "body": "Objective text." },
      "order": 2,
    },
  ],
}
```

Returns `{ record, blocks }` so the client reconciles ids, identifier, order
and versions without a second round-trip. Block `order` is optional; if
omitted, blocks are numbered `1..N` in array order.

### `update_block_payload`

Optimistic-concurrency content edit. The caller supplies the block `version`
it last saw; a stale version is rejected with `stale_version` (SQLSTATE
`SB001`) before any write.

```jsonc
// POST /api/db/rpc/update_block_payload
{
  "p_block_id": "00000000-0000-4000-8000-000000000110",
  "p_payload": { "body": "edited text" },
  "p_expected_version": 1,
  "p_payload_schema_version": 1,
}
```

Returns the updated block (with the new `version`).

### `move_block`

Atomically reorders a block via fractional indexing. The target position is
described by the blocks that should immediately precede (`p_after_block_id`)
and follow (`p_before_block_id`) the moved block after the move. Either may
be `null`: `(null, B)` moves to the start (before `B`); `(A, null)` moves
after `A`; `(null, null)` moves to the end. The caller supplies the record
`structure_version` it last saw; a stale version is rejected with
`stale_version`.

```jsonc
// POST /api/db/rpc/move_block
{
  "p_block_id": "00000000-0000-4000-8000-00000000011c",
  "p_expected_structure_version": 1,
  "p_after_block_id": "00000000-0000-4000-8000-000000000110",
  "p_before_block_id": "00000000-0000-4000-8000-000000000112",
}
```

Returns `{ block, structure_version, rebalanced, order }` where `order` is
the new `(id, order)` list for the record so the client can reconcile every
affected row. When the fractional gap between neighbours is too small to
represent, the RPC rebalances the whole record to integers `1..N` and sets
`rebalanced: true`.

### `archive_record` / `restore_record`

Reversible soft archival. Both require the `metadata_version` the client last
saw so a stale view cannot clobber a newer metadata edit.

```jsonc
// POST /api/db/rpc/archive_record
{ "p_record_id": "…", "p_expected_metadata_version": 1 }
// POST /api/db/rpc/restore_record
{ "p_record_id": "…", "p_expected_metadata_version": 2 }
```

Returns the updated record. `archive_record` sets `archived_at`;
`restore_record` clears `archived_at` and `deleted_at`.

### `create_record_link`

Validates that the target record (when referenced by id) exists in the same
workspace before inserting the link. Direct `INSERT` is still permitted under
RLS, but this RPC gives a stable `missing_link` error (SQLSTATE `SB002`)
instead of an ambiguous foreign-key violation when the target is invisible or
does not exist.

```jsonc
// POST /api/db/rpc/create_record_link
{
  "p_source_record_id": "…",
  "p_target_kind": "protocol_template",
  "p_target_identifier": "PRT-2025-0001",
  "p_link_type": "protocol",
  "p_target_record_id": "00000000-0000-4000-8000-000000000102",
  "p_label": "Stability Assay Protocol",
}
```

### `insert_block`

Appends a block at the end of the record, or inserts it immediately after a
given anchor block via fractional indexing. The caller supplies the record
`structure_version` it last saw; a stale version is rejected with
`stale_version` (SQLSTATE `SB001`) before any write. Payload shape validation
stays at the application boundary (`src/lib/blocks`); the RPC trusts the
caller's payload once the type is a known block type.

```jsonc
// POST /api/db/rpc/insert_block
{
  "p_record_id": "00000000-0000-4000-8000-000000000101",
  "p_type": "heading",
  "p_payload": { "level": 2, "text": "Methods" },
  "p_payload_schema_version": 1,
  "p_after_block_id": null,
  "p_expected_structure_version": 3,
}
```

Returns `{ block, structure_version }` so the client reconciles the new id,
order and the bumped structure version in one round-trip. When
`p_after_block_id` is omitted the block is appended; otherwise it is placed
between the anchor and the block that currently follows it. An anchor that
belongs to a different record is rejected with SQLSTATE `23503`.

### `delete_block`

Removes a block and bumps the record `structure_version`. As with
`insert_block`, an optional `p_expected_structure_version` guards against
clobbering a concurrent edit (SQLSTATE `SB001` on mismatch).

```jsonc
// POST /api/db/rpc/delete_block
{
  "p_block_id": "00000000-0000-4000-8000-00000000011c",
  "p_expected_structure_version": 4,
}
```

Returns `{ structure_version, order }` where `order` is the surviving
`(id, order)` list for the record so the client can confirm what remains.
`order` values are unchanged on delete (no renumber); the list simply omits
the deleted block.

## Stable error categories

The proxy re-wraps PostgREST errors into a public envelope
`{ error: { category, message, request_id } }`. Notebook operations surface
these categories:

| Category            | SQLSTATE | When                                                                |
| ------------------- | -------- | ------------------------------------------------------------------- |
| `validation_error`  | `23514`  | Unknown record kind, unknown block type, malformed payload.         |
| `validation_error`  | `SB003`  | Block payload failed shape validation (reserved for the RPC layer). |
| `stale_version`     | `SB001`  | `expected_version` / `expected_structure_version` mismatch.         |
| `missing_link`      | `SB002`  | `create_record_link` target unresolved or cross-workspace.          |
| `permission_denied` | `42501`  | RLS hid the row (wrong workspace, not a member, not owner).         |
| `conflict`          | `23505`  | Unique violation (e.g. duplicate `(record_id, order)`).             |

Clients branch on `category`, never on message text.

## Command-line examples

These use `curl` against the same-origin `/api/db` boundary with a browser
session cookie. External credentials use a Bearer token instead (see
`docs/external-api.md`); the RLS and RPC contracts are identical.

```bash
# List experiments in the active workspace, newest first
curl -sS -b cookie.txt '/api/db/records?kind=eq.experiment&order=created_at.desc'

# Load one notebook with its blocks in document order
curl -sS -b cookie.txt '/api/db/records?identifier=eq.EXP-2025-0001'
curl -sS -b cookie.txt '/api/db/blocks?record_id=eq.<record-id>&order=order.asc'

# Create a record with two initial blocks
curl -sS -b cookie.txt -H 'content-type: application/json' \
  -d '{"p_project_id":"<proj-id>","p_kind":"experiment","p_title":"Virus Stability","p_blocks":[{"type":"heading","payload":{"level":1,"text":"Virus Stability"},"order":1},{"type":"rich_text","payload":{"body":"Objective."},"order":2}]}' \
  /api/db/rpc/create_record_with_blocks

# Edit a block's payload (optimistic concurrency)
curl -sS -b cookie.txt -H 'content-type: application/json' \
  -d '{"p_block_id":"<block-id>","p_payload":{"body":"edited"},"p_expected_version":1}' \
  /api/db/rpc/update_block_payload

# Move a block between two neighbours
curl -sS -b cookie.txt -H 'content-type: application/json' \
  -d '{"p_block_id":"<block-id>","p_expected_structure_version":1,"p_after_block_id":"<after-id>","p_before_block_id":"<before-id>"}' \
  /api/db/rpc/move_block

# Archive then restore a record
curl -sS -b cookie.txt -H 'content-type: application/json' \
  -d '{"p_record_id":"<record-id>","p_expected_metadata_version":1}' \
  /api/db/rpc/archive_record
curl -sS -b cookie.txt -H 'content-type: application/json' \
  -d '{"p_record_id":"<record-id>","p_expected_metadata_version":2}' \
  /api/db/rpc/restore_record

# Link an experiment to a protocol
curl -sS -b cookie.txt -H 'content-type: application/json' \
  -d '{"p_source_record_id":"<exp-id>","p_target_kind":"protocol_template","p_target_identifier":"PRT-2025-0001","p_link_type":"protocol","p_target_record_id":"<proto-id>"}' \
  /api/db/rpc/create_record_link

# Insert a heading block after a given anchor
curl -sS -b cookie.txt -H 'content-type: application/json' \
  -d '{"p_record_id":"<record-id>","p_type":"heading","p_payload":{"level":2,"text":"Methods"},"p_payload_schema_version":1,"p_after_block_id":"<anchor-id>","p_expected_structure_version":3}' \
  /api/db/rpc/insert_block

# Delete a block
curl -sS -b cookie.txt -H 'content-type: application/json' \
  -d '{"p_block_id":"<block-id>","p_expected_structure_version":4}' \
  /api/db/rpc/delete_block
```

## Contract tests

`tests/db/notebook-rpcs.test.ts` proves create, load, edit, reorder, link,
archive and restore operations, the `insert_block` and `delete_block` RPCs
(append, after-anchor fractional indexing, stale-version guard, cross-record
anchor rejection, surviving order list), plus the `stale_version`,
`missing_link` and cross-workspace permission-denial paths, against a freshly
migrated `sheetbase_test` with real `authenticated` claim GUCs.

## Durable change events (LIVE-001)

Every durable mutation to `projects`, `folders`, `records`, `blocks` and
`record_links` — whether through the RPCs above or direct PostgREST CRUD —
appends a row to `api.change_events`, workspace-scoped and ordered by a
per-workspace gapless `sequence`. The pair `(workspace_id, sequence)` is the
stable replay cursor. Events are written by `SECURITY DEFINER` AFTER
triggers; request roles can read events only for their own workspace and can
neither write nor forge them. See decision record 0016.

### Event shape

| field                       | meaning                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `workspace_id` / `sequence` | replay cursor                                                                       |
| `entity_type`               | `project` / `folder` / `record` / `block` / `record_link`                           |
| `entity_uuid`               | the changed entity's id                                                             |
| `operation`                 | `create` / `update` / `move` / `delete` / `archive` / `restore` / `link` / `unlink` |
| `record_id`                 | record identity for block/link events; null otherwise                               |
| `project_id`                | project context (equals `entity_uuid` for project events)                           |
| `actor_user_id`             | the acting user (from JWT `sub`); null on bootstrap paths                           |
| `client_id`                 | the acting client identity (from JWT `client_id`); null until LIVE-003              |
| `payload`                   | lightweight summary (changed fields, new order, bumped version)                     |
| `created_at`                | event timestamp                                                                     |

### Reading the event stream

```bash
# Authenticated browser session: events for the caller's workspace, in order.
curl -sS -b cookie.txt \
  '/api/db/change_events?order=sequence.asc&select=sequence,entity_type,entity_uuid,operation,record_id,project_id,actor_user_id,client_id,payload,created_at'
```

A reconnecting client requests `?sequence=gt.<last-seen>` to fetch only what
it missed. LIVE-002 wraps this in an authenticated SSE endpoint.

### Forgery prevention

`change_events` has no `INSERT`/`UPDATE`/`DELETE` grants to any request role
and RLS restricts reads to the caller's workspace. The `internal.emit_change_event`
writer lives in the `internal` schema (not exposed to PostgREST) and has no
`EXECUTE` grant for request roles. The contract tests in
`tests/db/change-events.test.ts` prove direct writes by an authenticated
caller are denied.

## Live change events stream (LIVE-002)

`GET /api/events` is an authenticated, workspace-scoped Server-Sent Events
stream that delivers durable change events as they happen. Open it with the
browser's native `EventSource`:

```js
const es = new EventSource('/api/events')
es.addEventListener('change', (ev) => {
  const event = JSON.parse(ev.data)
  // event: { id, workspaceId, sequence, entityType, entityUuid, operation,
  //          recordId, projectId, actorUserId, clientId, payload, createdAt }
})
es.addEventListener('reset', (ev) => {
  const { reason, resumeFrom } = JSON.parse(ev.data)
  // Reconnect; the browser's EventSource resends Last-Event-ID automatically.
})
```

### Reconnect and replay

Each `change` event carries `id: <sequence>`. On reconnect, `EventSource`
sends `Last-Event-ID: <last sequence>` automatically; the server replays
durable events with `sequence > last-seen` (bounded to a single batch)
before switching to live notifications. No client-side cursor state is
required.

The server also accepts `?after=<seq>` as a resume-cursor override. This is
used by the LIVE-003 client after a `reset` whose `resumeFrom` is below the
browser's tracked `Last-Event-ID` (the `history_unavailable` case): a
fresh `EventSource('/api/events?after=<resumeFrom>')` avoids the
infinite-reset loop that native `Last-Event-ID` would otherwise cause.

### Reset

If the requested history is unavailable (the cursor points into cleaned-up
retention) or the replay batch hits the bound, the server emits a `reset`
control event with `{ reason: 'history_unavailable' | 'replay_bound',
resumeFrom }` and closes the connection. The client refetches the current
state of the affected collections and reconnects from `resumeFrom`.

### Heartbeats and session expiry

The server sends `:heartbeat` comment lines to keep the connection alive
and periodically re-checks the Better Auth session; an expired session
produces a `bye` event with `{ reason: 'session_expired' }` and closes the
stream.

### Workspace isolation

The subscription filters notifications by `workspace_id`; a caller never
sees event metadata from another workspace. The contract is proven in
`tests/db/sse-events.test.ts`.

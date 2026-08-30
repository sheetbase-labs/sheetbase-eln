# 0016. Durable workspace change events

- **Status:** accepted
- **Date:** 2026-07-19
- **Ticket:** LIVE-001

## Context

Phase 3 needs multi-tab liveness: a user editing a notebook in one browser
tab must see coherent changes in a second tab without a full reload
(`ROADMAP.md` §3 exit gate). That requires a durable record of what changed,
scoped to a workspace, ordered so a reconnecting client can replay only what
it missed, and protected from client forgery.

Two forces conflicted:

- The notebook RPCs (`create_record_with_blocks`, `update_block_payload`,
  `insert_block`, `delete_block`, `move_block`, `archive_record`,
  `restore_record`, `create_record_link`) are the controlled mutation paths,
  but direct PostgREST CRUD on the domain tables is also permitted under RLS
  (the RPCs exist for multi-row atomicity and stale-version guards, not to
  gate every write). A durable event system that only observed RPC calls
  would miss direct CRUD.
- Clients must not be able to forge or rewrite history. Any writer reachable
  through PostgREST as an RPC is reachable by every authenticated caller.

## Decision

Add an append-only `api.change_events` table, workspace-scoped, with a
per-workspace gapless monotonic `sequence` (backed by
`api.workspace_change_seq`). The pair `(workspace_id, sequence)` is the
stable replay cursor for LIVE-002 SSE reconnection.

Events are written **exclusively by `SECURITY DEFINER` AFTER triggers** on
`api.projects`, `api.folders`, `api.records`, `api.blocks` and
`api.record_links`. The trigger functions live in the `internal` schema
(not exposed to PostgREST), are owned by the migrator, and call a single
`internal.emit_change_event` helper. Because the triggers fire on every DML
regardless of caller, every mutation — RPC or direct PostgREST CRUD — emits
transactionally; because the writer runs as the table owner under
`SECURITY DEFINER`, request roles bypass neither RLS nor the absence of
write grants.

`change_events` carries:

- `entity_type` / `entity_uuid` / `operation` (semantic, derived from
  OLD/NEW — e.g. a block `order` change is `move`, an `archived_at`
  transition is `archive`/`restore`);
- `record_id` and `project_id` scoping hints so LIVE-003 can invalidate only
  the affected collections;
- `actor_user_id` and `client_id` from the request JWT claims (via
  `api.claim_probe`);
- a lightweight `payload` summary (changed fields, new order, bumped
  version) — never the full source of truth.

A `pg_notify('sheetbase_change', …)` fires with each event carrying only a
pointer (`workspace_id`, `sequence`, `id`). LIVE-002 listeners refetch the
durable row; the notification never carries the source of truth.

### Grants and RLS

- `authenticated` and `api_client` get `SELECT` only, under RLS policies
  that scope reads to the caller's active workspace (members for
  `authenticated`, workspace token for `api_client`).
- No `INSERT`/`UPDATE`/`DELETE` grants to any request role.
- `internal.emit_change_event` has `REVOKE … FROM PUBLIC` and **no grant**
  to request roles — only migrator-owned trigger functions call it.

### Bootstrap path

`emit_change_event` skips emission when `request.jwt.claims` is absent or
has no `sub`. Seed and migration therefore stay quiet; the sequence reflects
only real user mutations. `actor_user_id` is nullable for the same reason.

## Consequences

- Every durable mutation produces a durable, replayable event with no client
  cooperation and no application-side emit calls to keep in sync.
- A failed RPC (e.g. stale-version `SB001`) rolls back the whole transaction
  including the event — no phantom events.
- Direct PostgREST CRUD also emits events; LIVE-003 invalidation does not
  need to know which path produced a change.
- Adding a new domain table requires adding its trigger; the emit helper
  stays shared.
- Cascade deletes (e.g. deleting a record cascades to its blocks) emit a
  `delete` event per block plus the record `delete`; the block trigger skips
  when the parent record is already gone, avoiding double-echo of the
  record's own deletion.
- `client_id` is nullable until LIVE-003 wires the client to send one; the
  schema is ready.

# 0018 — Notebook autosave and conflict handling

**Status:** accepted
**Phase:** 3 — ELN-007
**Depends on:** 0015-notebook-domain-vocabulary, 0017-live-event-reconciliation

## Context

ELN-005 delivered typed block editing with an explicit Save button and
blur-save. ELN-006 added reordering. LIVE-003 connected notebook queries
to the live-event stream so a second tab's edits arrive without a reload.
The remaining gap is autosave: every keystroke should not hit the server,
but work must never be silently lost, and a version conflict must preserve
both sides behind an explicit choice.

The block RPC (`update_block_payload`) uses optimistic concurrency: the
caller sends `expectedVersion`, and a newer server version returns
`SB001` (`stale_version`). The client identity (`x-sheetbase-client-id`, 0017) is already attached to every `/api/db` request by `createDataClient`;
it does not need to be passed as a separate save argument.

## Decision

A per-block `useAutosave` state machine wraps each typed editor. The
document aggregates per-block status into a single `hasUnsavedWork`
signal for navigation guards.

1. **Debounce.** Edits are debounced (default 800 ms). Blur flushes
   immediately. Rapid edits coalesce into one save — the hook tracks a
   monotonic draft revision so a slow response cannot mark a newer draft
   saved.

2. **Status states.** The hook exposes seven truthful states: `clean`,
   `dirty` (debouncing), `saving`, `retrying`, `offline`, `failed`, and
   `conflict`. `SaveStatus` renders icon + text (never color alone).

3. **Expected version.** The route reads the latest block version from
   the TanStack Query cache at call time, not from a stale closure. This
   keeps saves targeting the right version after a live-event version
   bump.

4. **Conflict handling.** On `stale_version`, the route refetches the
   canonical block list and returns a `SaveResult` with `kind: 'conflict'`
   and the server's payload as `serverValue`. The hook preserves both the
   local draft and the server value; the `ConflictBanner` offers
   "Use server version" (discard local) and "Keep my edit" (retry against
   the latest version). Neither side is silently overwritten.

5. **Retry with bounds.** Transient failures (network, 5xx) retry with
   exponential backoff up to `maxRetries` (default 3). Exhausted retries
   settle to `failed`. Permanent validation failures (`SB003`) do not
   retry — they stay attached to the block until the draft is corrected.

6. **Offline hold.** When the live-event stream is offline
   (`useLiveStatus().status === 'offline'`), the hook holds dirty work
   and settles to `offline` status. Saves resume when the stream
   reconnects.

7. **Navigation guards.** `NotebookDocument` installs a `beforeunload`
   handler for tab closure. The route uses TanStack Router's `useBlocker`
   for in-app navigation, gated on the aggregate `hasUnsavedWork` signal.
   Both fire only when unsaved work genuinely remains at risk — a clean
   notebook navigates freely.

## Consequences

- The explicit Save button is removed; blur and debounce replace it.
  This is the right UX for a lab notebook where blocks are short and
  edits are frequent.
- The `SaveResult` type is the structured contract between the route and
  the editor. The route maps RPC errors to `conflict` / `validation` /
  `transient`; the hook branches on `kind`.
- The route's old `saveMutation` is removed. The route now calls
  `updateBlockPayload` directly inside `handleSave` so it can refetch and
  return conflict data in the same call.
- The `onSaveBlock` callback changed from `Promise<void>` (rejecting on
  error) to `Promise<SaveResult>` (returning structured results). The
  read-only branch returns `{ ok: true }` as a no-op.

## Amendment — durable offline edits (DEC-09, 2026-09-27)

The v3 design (`canvas/NbOffline.dc.html`, `canvas/NbConflict.dc.html`,
`canvas/SignedOut.dc.html`) requires edits to survive a lost connection and a
sign-out, so this ADR is extended:

1. **Device store.** Pending edits are persisted in IndexedDB, keyed by user,
   workspace and record. It holds only the user's un-synced drafts: block text,
   sheet-cell edits, added rows and draft comments. Server-authoritative values
   are not copied into it. Entries are removed after a successful sync.
2. **Offline capability.** Editing text, sheet cells, adding rows and comments
   work offline. Imports, re-running analyses, submitting, signing and search
   require a connection, as the design states.
3. **Replay with expected revisions.** On reconnect, drafts replay in order
   through the canonical RPCs with the expected revisions the user last saw:
   `expectedVersion` for blocks, the sheet write path's expected revisions for
   cells and rows. A replayed write that is stale surfaces a conflict; it never
   overwrites the server value.
4. **Conflict granularity.** Blocks keep block-level conflicts (this ADR);
   sheet cells resolve per cell, as `NbConflict` shows ("Resolved conflict ·
   row 6 · Capsid titre"). The user keeps their edit or takes the server value
   per conflict, and the choice is attributed.
5. **Sign-out retention.** Un-synced drafts survive sign-out until the user
   explicitly discards them; the signed-out page explains that they are kept
   and offers retry or discard after sign-in. Drafts are per user and are never
   visible to another user.

Submitting and signing remain online-only, so a retained draft can never become
signed evidence while offline.

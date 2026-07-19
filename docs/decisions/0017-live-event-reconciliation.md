# 0017 — Live-event reconciliation into TanStack Query

**Status:** accepted
**Phase:** 3 — LIVE-003
**Depends on:** 0016-durable-workspace-change-events

## Context

LIVE-001 created durable workspace change events; LIVE-002 delivered them
over an authenticated, replayable SSE stream at `/api/events`. The remaining
gap is the client side: a second browser tab's edits must arrive in the
first tab without a full-page reload, the client must reconcile its own
echoed events without double-applying, and the UI must surface connection
health quietly.

The notebook UI already uses TanStack Query (`useQuery`/`useMutation`)
with per-entity query keys (`notebookQueryKeys`). TanStack DB is installed
but not yet used; it will back scientific sheets in Phase 4. This decision
connects TanStack Query to live events now and leaves TanStack DB for
sheets.

## Decision

A single `LiveEventProvider` mounts at the root route and owns one
`createLiveEventCoordinator` for the whole session. The coordinator:

1. **Stable client identity.** Each tab mints a UUID in `sessionStorage`
   (`src/lib/client-identity.ts`) and sends it as `x-sheetbase-client-id`
   on every `/api/db` request. The proxy mints it into the PostgREST JWT
   as `client_id`; the durable change-event trigger (0016) records it.
   `sessionStorage` is tab-scoped, so two tabs get distinct ids — the
   desired two-tab semantics.

2. **Self-echo suppression.** When an event's `clientId` matches this
   tab's id, the coordinator skips cache application. The mutation's own
   `onSuccess` already reconciled the canonical result, so the echo would
   be redundant. The cursor still advances so a later replayed batch does
   not re-apply.

3. **Targeted invalidation.** Each event maps to the narrowest set of
   query keys it affects:
   - `project` → `project(id)` + `projectsList()`
   - `record` → `record(id)` + `records(projectId)` + `projectsList()`
   - `block` → `blocks(recordId)` + `record(recordId)` (structure version)
   - `record_link` → `links(recordId)`

   The coordinator never does a global invalidation for a single event;
   it refetches only the collections whose data changed. Background
   refetch preserves pending optimistic state for unrelated in-flight
   mutations.

4. **Duplicate suppression.** The coordinator tracks the highest sequence
   applied per workspace and drops any event whose sequence is ≤ that
   cursor, so a replayed event delivered again or a duplicate live
   notification is applied at most once.

5. **Reset recovery.** On a `reset` (`history_unavailable` or
   `replay_bound`), the coordinator invalidates every workspace-scoped
   collection and reconnects from `resumeFrom` via `?after=<seq>`. This
   avoids the infinite-reset loop that native `Last-Event-ID` would cause
   when the cursor points into cleaned-up history (the browser would
   resend the stale cursor and the server would reset again). The SSE
   handler accepts `?after=` as a resume-cursor override.

6. **Status UI.** A quiet `ConnectionStatus` indicator in the app-shell
   top bar shows `live` / `connecting` / `reconnecting` / `offline` with
   icon + colour + tooltip (DESIGN.md: never colour alone; offline is
   quiet but explains what will or will not sync).

The coordinator is a pure function of injectable deps (EventSource factory

- QueryClient), so the full two-tab / reconnect / duplicate / reset matrix
  is unit-tested without a database or network.

## Consequences

- The proxy and JWT minter carry a new `client_id` claim; the durable
  change-event trigger already read it (0016), so no migration is needed.
- `x-sheetbase-client-id` is read by the proxy and stripped before
  forwarding upstream (the proxy builds a fresh header set).
- `notebookQueryKeys` gained a `projectsList()` entry; `projects.tsx`
  uses it so the coordinator can invalidate the list.
- TanStack DB remains unused; Phase 4 will introduce it for sheets and
  may share the coordinator's invalidation map.

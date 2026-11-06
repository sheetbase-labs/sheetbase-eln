# COLLAB — Collaboration Architecture

Status: implemented. Live co-editing and presence ship with Sheetbase: a small
WebSocket server runs inside the same Node process as the web app, on the same
port, with nothing else to install, pay for or sign up to. It replaces the
hosted Liveblocks service the first version used. **PostgreSQL remains the only
authority for scientific state, identity, permissions and evidence.**

## State boundary

| Concern                                                           | Lives in                             |
| ----------------------------------------------------------------- | ------------------------------------ |
| Records, Notebook blocks, Sheet Instances, Datasets, rows, fields | PostgreSQL (`api` schema)            |
| Revisions, submissions, review decisions, signatures, evidence    | PostgreSQL                           |
| Workspace membership, roles, suspension                           | PostgreSQL (`workspace_memberships`) |
| Comment threads and mentions on records and blocks                | PostgreSQL (`api.comments`)          |
| Notifications (mentions, replies, reviews)                        | PostgreSQL (`api.my_notifications`)  |
| Who is here, which block they are in, their caret and selection   | Co-editing room (ephemeral, memory)  |
| The text of a rich text block while two or more people edit it    | Co-editing room (ephemeral, memory)  |

A room exists only while someone is connected (plus 30 seconds, so a reload
rejoins the same session). Nothing is written to disk. Every editor still saves
its block through the ordinary notebook save path, so the database always holds
the text, and a new session starts by seeding the room from the saved block.
Comments and notifications never lived in the room: they use the app's own
comment and notification tables.

## Pieces

| Piece                                                               | Job                                                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `scripts/lib/collab-server.mjs`                                     | The WebSocket relay: rooms, Yjs sync, presence, seed claims, per-connection rights |
| `scripts/lib/collab-host.mjs`                                       | Wires the relay to the app: asks `/api/collaboration/ticket` who a connection is   |
| `scripts/serve-production.mjs`, `vite.config.ts`                    | Attach the relay to the production server and to the Vite dev server               |
| `src/routes/api/collaboration/ticket.ts`                            | Session + membership + object authority for one room (below)                       |
| `src/lib/collaboration/provider.ts`                                 | Browser side: reconnecting WebSocket, Yjs document, presence                       |
| `src/lib/collaboration/room-hooks.ts`                               | `useOthers`, `useUpdateMyPresence`, `useRoomConnection`                            |
| `src/components/collaboration/collaboration-room.tsx`               | Joins a room for a page; renders children unchanged when collaboration is off      |
| `src/components/notebook/live-rich-text.ts`, `rich-text-editor.tsx` | Binds a rich text block to the room's shared text                                  |

## Room naming

Deterministic from canonical identities only:

```text
workspace:<workspaceId>:record:<recordId>        # a notebook: presence and live block text
workspace:<workspaceId>:sheet:<sheetInstanceId>  # sheet instance: presence
workspace:<workspaceId>:dataset:<datasetId>      # dataset: presence
```

Built by `buildRoomId()`; parsed by `parseRoomId()`, which rejects anything that
is not four segments with UUID workspace/object ids. The server accepts the same
shape and nothing else.

## Authentication model

1. The browser opens `wss://<app>/api/collaboration/ws?room=<room>`. The
   browser's own session cookie rides on the upgrade.
2. The server rejects the upgrade unless its `Origin` header names the app's
   own host (browsers send cookies on cross-site WebSocket requests, so this is
   what stops another web page joining a room as the signed-in person).
3. The server calls the app's `GET /api/collaboration/ticket?room=...` with
   those cookies. `resolveRoomAccess()` (src/lib/collaboration/access.server.ts)
   verifies:
   - the room id parses to a known shape;
   - the Better Auth session is valid;
   - the workspace exists and `status = 'active'`;
   - the object's **lifecycle** inside exactly that workspace resolves to a
     grantable state (soft-deleted records and unknown ids are denied);
   - the caller holds an unsuspended membership in that workspace;
   - `api.collaboration_object_state` applies current canonical View and Edit
     authority through `internal.can_access_object` (0323), including explicit
     individual and group project rules;
   - records and a sheet's parent notebook also pass
     `internal.record_readable_by` (0434), including private-draft restrictions.
4. The ticket says who the person is and whether they may write. The server
   holds that for the life of the connection and tells the browser (message 3).

A client never supplies its own identity, workspace or permissions. Two guards
keep it that way inside a connection: the server drops every document change a
read-only connection sends, and it closes any connection whose presence claims
to be a different user than the one the ticket named.

Writers get `room:write`; viewers, View-only writers and anyone on an archived
or locked object get `room:read`. Suspended members, non-members and other
workspaces are refused with a final close code (4401 not signed in, 4403 no
access), which the browser treats as "stop retrying".

### Revocation boundary

Every connection rechecks current authority when it is made, with no
server-side permission cache. Removing View, a granting group membership or
workspace membership blocks the next connection. Removing Edit downgrades the
next one. A connection that is already open keeps the rights it was given until
it reconnects; the server pings every 30 seconds and drops dead sockets, but
there is no promised moment at which a revoked person's open socket closes.
Revoked people still cannot save: saving goes through PostgreSQL, which checks
authority on every write. A room carries no secrets that are not also on the
page they were already allowed to open.

## Permission matrix

Active, writable object, after canonical View has been granted. Writer rows
also require current Edit; without Edit they receive the viewer grant:

| Who                                                            | Connect | See presence | Edit text together |
| -------------------------------------------------------------- | ------- | ------------ | ------------------ |
| owner/admin/member/steward/scientist/analyst/reviewer (active) | yes     | yes          | yes                |
| viewer (GOV-01 read-only)                                      | yes     | yes          | no                 |
| suspended member                                               | no      | no           | no                 |
| non-member / cross-workspace                                   | no      | no           | no                 |
| suspended/archived workspace                                   | no      | no           | no                 |

| Object lifecycle                                                   | Writer receives | Viewer receives |
| ------------------------------------------------------------------ | --------------- | --------------- |
| writable (`lifecycle='active'`, not locked/deleted)                | `room:write`    | `room:read`     |
| archived record / sheet instance / dataset; locked (signed) record | `room:read`     | `room:read`     |
| soft-deleted record (`deleted_at`) or unknown id                   | denied outright | denied outright |

## Live editing of a rich text block

A block's editor binds to the room's shared copy of that block (a Yjs XML
fragment named `block:<blockId>`) when the person's connection is writable and
has finished syncing, and they have not already started typing. Otherwise it is
the ordinary private editor. Pieces that matter:

- **Seeding.** The first person to open a block asks the server for the right to
  seed it (a message the server grants to exactly one connection per block, and
  takes back if that connection drops). They write the saved text into the
  shared document in one transaction, marking the block seeded. Everyone else
  waits for that text to arrive. Two people opening a block in the same instant
  therefore never both paste the saved text.
- **Saving.** Each person's own typing is saved by the usual autosave, on the
  usual version check. Text that arrived from a collaborator is not an edit of
  theirs: its author saves it, and if the author goes quiet for 4 seconds and
  nothing has been saved, the person who received it saves it, so closing a tab
  never strands text only a peer was shown.
- **Conflicts.** If a save loses the version race, and the newer saved text is
  one this editor has already shown (so it came from a collaborator in the room),
  the editor saves its merged text over it automatically. A newer save from
  anywhere else (an import, the API, the assistant, someone not in the room) is
  never overwritten: the usual conflict banner appears and the person chooses.
- **Stale rooms.** If a person rejoins a block's room alone and the saved block
  no longer matches the room's text (it was changed elsewhere in the 30-second
  grace period), the room is reseeded from the saved block.
- **Undo** belongs to the shared document while live: it takes back only your own
  typing, never a collaborator's.
- **Carets.** Other people's carets and selections show with their name in a
  colour derived from their user id.

Other block types (checklists, tables, sheets and so on) are not shared text:
they keep saving whole payloads with the version check, and presence tells people
who else is in the block.

## Presence

Awareness state per connection: the verified user (`id`, `name`, `avatar`,
`color`), the block being edited, the mode (viewing or editing), and for sheets
the selected rows. It drives the avatar stack in page headers, the "Editing
here" badge on a block, and the remote selection chips on sheets. Presence is
awareness only: it never locks anything and never changes saved data.

## Comments and notifications

Block, record and review comments are ordinary `api.comments` rows (see the
Comments panel and `src/lib/comments-data.ts`), with @mentions notifying through
the same notification path as every other event. They are not part of the room,
so they work without a live connection and are included in exports and the audit
trail like any other comment. Revision-frozen review annotations (REV-004) are
unchanged.

## Operating it

- On by default. `SHEETBASE_COLLABORATION=off` turns it off (the page then runs
  exactly as it did with no room: no connection, no presence, private editors).
- The WebSocket is served by the app process on the app's port, at
  `/api/collaboration/ws`. A reverse proxy in front of the app must pass the
  `Upgrade` and `Connection` headers and keep idle connections open for at least
  a minute (the server pings every 30 seconds). Caddy and Cloudflare Tunnel do
  this by default; for nginx set `proxy_http_version 1.1`, the two upgrade
  headers and a `proxy_read_timeout` of 60s or more.
- Run one app process per deployment for live editing: rooms live in that
  process's memory, so two replicas behind a round-robin balancer would put
  collaborators in different rooms. A single process serves a lab comfortably.
  Sticky routing by room is the way to scale out; nothing else changes.
- Memory: a room holds one Yjs document and is dropped 30 seconds after its last
  connection. A room is capped at 100 connections and 64 MB of changes.
- Settings > Diagnostics shows whether live co-editing is enabled.

## Authority regression tests

`pnpm test:db collaboration-authority` exercises the actual server resolvers
against a freshly migrated PostgreSQL database. Only session identity is
substituted. It covers forbidden projects, private drafts and parent notebooks,
workspace isolation, View-only writers, viewers, archived and locked objects,
deletion, and fresh grants after revocation. `scripts/lib/collab-server.test.ts`
covers the relay (read-only drops, identity checks, seed exclusivity, origin
checks), and `tests/browser/collab-01-co-editing.test.ts` runs two browsers
typing in one block against the real server.

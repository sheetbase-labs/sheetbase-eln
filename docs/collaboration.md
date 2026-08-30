# COLLAB — Collaboration Architecture

Status: implemented (COLLAB-01–04). Liveblocks is the realtime substrate for
presence, comments and collaboration notifications. **PostgreSQL remains the
only authority for scientific state, identity, permissions and evidence.**

## State boundary

| Concern                                                           | Lives in                             |
| ----------------------------------------------------------------- | ------------------------------------ |
| Records, Notebook blocks, Sheet Instances, Datasets, rows, fields | PostgreSQL (`api` schema)            |
| Revisions, submissions, review decisions, signatures, evidence    | PostgreSQL                           |
| Workspace membership, roles, suspension                           | PostgreSQL (`workspace_memberships`) |
| Presence (who is here, selection, viewing/editing mode)           | Liveblocks (ephemeral)               |
| Comment threads + mentions on live objects                        | Liveblocks Comments                  |
| Thread resolution state on live objects                           | Liveblocks thread metadata           |
| Collaboration notifications (mention/reply inbox)                 | Liveblocks Inbox Notifications       |
| Revision-frozen review annotations (REV-004 `api.comments`)       | PostgreSQL — unchanged               |

The system stores nothing canonical in Liveblocks Storage. No scientific
content enters a room id or thread metadata. Metadata carries only stable
identifiers.

## Packages

`@liveblocks/client`, `@liveblocks/react`, `@liveblocks/react-ui`,
`@liveblocks/node`. Do not import Liveblocks outside
`src/lib/collaboration/liveblocks.config.ts`; product code uses the
re-exported suspense hooks there. Types come from the global `Liveblocks`
interface (`Presence`, `UserMeta`, `ThreadMetadata`, `RoomInfo`).

## Room naming

Room ids derive deterministically from canonical identities only:

```text
workspace:<workspaceId>:record:<recordId>    # record-level + notebook-block threads
workspace:<workspaceId>:sheet:<sheetInstanceId>  # sheet-instance presence
workspace:<workspaceId>:dataset:<datasetId>  # dataset / row / field / cell threads
```

`buildRoomId()` builds room ids. `parseRoomId()` parses them and rejects
anything that is not four segments with UUID workspace/object ids.

## Authentication model

1. The browser client calls `POST /api/collaboration/auth { room }`.
2. The endpoint resolves the Better Auth session (`getAppSession`). The
   server never trusts a client-supplied user/workspace/role.
3. `resolveRoomAccess()` (src/lib/collaboration/access.server.ts) verifies:
   - the room id parses to a known shape;
   - the workspace exists and `status = 'active'`;
   - the object's **lifecycle** inside exactly that workspace resolves to a
     grantable state (the system denies soft-deleted records and unknown ids);
   - the caller holds an unsuspended membership in that workspace.
4. The endpoint mints a least-privilege token for exactly that room via
   `@liveblocks/node prepareSession().allow(room, scopes).authorize()`.

Base scopes: writers get `room:write, comments:write, storage:none,
feeds:none`; viewers get `room:read, comments:read, storage:none,
feeds:none`. Storage and feeds are explicitly denied because Sheetbase stores
no content in Liveblocks. The final grant is then intersected with object
lifecycle (see matrix below).

Revocation semantics: every (re)connection re-authenticates through this
endpoint. Removal or suspension therefore blocks all future access
immediately. An already-open connection persists until its token expires.
Hard eviction of live sockets would require Liveblocks webhooks; the team
deliberately deferred it.

## Permission matrix

Sheetbase is authoritative. React-side hiding of controls is never the
boundary — the server-issued scopes are.

Active, writable object:

| Who                                                            | Connect | Read presence/threads | Create/reply/resolve/reopen |
| -------------------------------------------------------------- | ------- | --------------------- | --------------------------- |
| owner/admin/member/steward/scientist/analyst/reviewer (active) | yes     | yes                   | yes                         |
| viewer (GOV-01 read-only)                                      | yes     | yes                   | no                          |
| suspended member                                               | no      | no                    | no                          |
| non-member / cross-workspace                                   | no      | no                    | no                          |
| suspended/archived workspace                                   | no      | no                    | no                          |

Lifecycle intersection — final grant = role capability x object state:

| Object lifecycle                                                   | Writer receives      | Viewer receives |
| ------------------------------------------------------------------ | -------------------- | --------------- |
| writable (`lifecycle='active'`, not locked/deleted)                | `comments:write`     | `comments:read` |
| archived record / sheet instance / dataset; locked (signed) record | `comments:read` only | `comments:read` |
| soft-deleted record (`deleted_at`) or unknown id                   | denied outright      | denied outright |

Archived/locked objects therefore become collaboration-read-only for
everyone. The minted token enforces this, not UI hiding.

Mention suggestions (`GET /api/collaboration/mentions`) return only active
members of the requested room's workspace. User resolution
(`/resolve/users`) returns only users who share a workspace with the caller.

## Thread anchor model (COLLAB-02)

Every thread's flat scalar metadata encodes one typed anchor from
`src/lib/collaboration/types.ts`:

- `record` — record-level discussion;
- `notebook-block` — stable block UUID (survives reorder);
- `dataset` / `dataset-row` / `dataset-field` / `dataset-cell` — dataset id +
  durable row/field UUIDs.

This release deliberately has **no sheet-cell/range anchors**. The Sheet
Instance model has no canonical per-row persisted identity yet, and the
legacy generated `api.sheet_*` scientific tables are retired — review
rejected binding a new product feature to them. A queued follow-up task
("Canonical Sheet stable row identity + Sheet-cell collaboration anchors")
adds the row identity to the Sheet Instance model first. Until then, sheet
rooms carry presence only. The anchor contract rejects retired kinds
outright.

Anchors never contain visible row numbers, column labels, titles, DOM
coordinates or content-derived hashes. Comments therefore stay attached
across edit/reorder/rename. Deleted or archived anchor targets render an
honest unavailable/historical state. They do not silently disappear the
discussion.

## Surfaces

- Notebook header/block gutter: presence avatars, per-block comment affordance.
- Canonical sheet workspace (`/sheets/$instanceId`): presence avatars and
  remote-selection awareness in the toolbar (presence only).
- Dataset detail inspector: Discussion tab; header avatar stack.
- Record overview inspector: Discussion section (pre-submission included);
  post-submission REV-004 revision annotations remain separate and authoritative.
- App shell top bar: global notification inbox bell.
- Review screens: reviewer awareness; authoritative review actions unchanged.

## Notifications (COLLAB-03)

Liveblocks inbox notifications carry mention/reply/thread events. Deep links
are resolved server-side by `/api/collaboration/resolve/rooms`. That endpoint
returns names/urls only for rooms the caller can access. It omits
inaccessible rooms, so the inbox can never leak object names. Liveblocks
manages read/unread state. Email delivery is intentionally out of scope.

## Review coordination (COLLAB-04)

Reviewer assignment, review state, decisions, signatures and evidence remain
exactly as shipped (review_submissions / review RPCs). Liveblocks adds only
awareness (who is viewing the review) and coordination UX around it.
Liveblocks threads are **not** part of any signed/frozen revision evidence
unless a future, explicit evidence-capture feature says so.

## Retention and deletion

- Archived objects become read-only. Their rooms grant read-only scopes to
  everyone (enforced by the token mint). Existing comments stay visible as
  collaboration context and are **not** silently deleted.
- Soft-deleted records lose room access entirely.
- Project/workspace deletion should delete corresponding rooms
  (`workspace:<wsId>:*` patterns) via the Liveblocks REST API. The deletion
  flows currently live outside the app (operational), so room cleanup is an
  operator step until a first-party deletion flow exists.
- User access loss removes future room access (see auth model). Historical
  authored comments keep their author id and render through
  permission-filtered user resolution.

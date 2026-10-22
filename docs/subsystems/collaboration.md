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

Nothing canonical is stored in Liveblocks Storage. No scientific content ever
enters a room id or thread metadata: metadata carries only stable identifiers.

## Packages

`@liveblocks/client`, `@liveblocks/react`, `@liveblocks/react-ui`,
`@liveblocks/node`. All Liveblocks imports outside
`src/lib/collaboration/liveblocks.config.ts` are forbidden; product code uses
the re-exported suspense hooks there. Typed via the global `Liveblocks`
interface (`Presence`, `UserMeta`, `ThreadMetadata`, `RoomInfo`).

## Room naming

Deterministic from canonical identities only:

```text
workspace:<workspaceId>:record:<recordId>    # record-level + notebook-block threads
workspace:<workspaceId>:sheet:<sheetInstanceId>  # sheet-instance presence
workspace:<workspaceId>:dataset:<datasetId>  # dataset / row / field / cell threads
```

Built by `buildRoomId()`; parsed by `parseRoomId()`, which rejects anything
that is not four segments with UUID workspace/object ids.

## Authentication model

1. Browser client calls `POST /api/collaboration/auth { room }`.
2. The endpoint resolves the Better Auth session (`getAppSession`). No
   client-supplied user/workspace/role is ever trusted.
3. `resolveRoomAccess()` (src/lib/collaboration/access.server.ts) verifies:
   - the room id parses to a known shape;
   - the workspace exists and `status = 'active'`;
   - the object's **lifecycle** inside exactly that workspace resolves to a
     grantable state (soft-deleted records and unknown ids are denied);
   - the caller holds an unsuspended membership in that workspace;
   - `api.collaboration_object_state` applies current canonical View and Edit
     authority through `internal.can_access_object` (0323), including explicit
     individual and group project rules;
   - records and a sheet's parent notebook also pass
     `internal.record_readable_by` (0434), including private-draft restrictions.
4. A least-privilege token is minted for exactly that room via
   `@liveblocks/node prepareSession().allow(room, scopes).authorize()`.

Base scopes: writers get `room:write, comments:write, storage:none,
feeds:none`; viewers get `room:read, comments:read, storage:none,
feeds:none`. Storage and feeds are explicitly denied because Sheetbase stores
no content in Liveblocks. The final grant is intersected with current Edit
authority and object lifecycle. A workspace writer with only project View
receives read-only scopes. Sheets also inherit their parent notebook's
archived, locked, or deleted state.

### Revocation boundary

Every fresh token issuance rechecks current authority without a server-side
permission cache. Removing View, a granting group membership, or workspace
membership blocks the next issuance. Removing Edit downgrades the next grant.
Room-name resolution and mention suggestions also recheck current authority.
Successful auth and object-resolution responses use `Cache-Control: private,
no-store`.

This is **not immediate revocation of an issued Liveblocks access token**.
The v3.24.1 client caches tokens and can reuse them on reconnect, so a
reconnection does not necessarily call Sheetbase. The issued token carries
`iat` and `exp`; `prepareSession().allow().authorize()` exposes no configurable
TTL. Neither token expiry nor the SDK's cache deadline establishes when an
already-open socket closes. No fixed socket revocation deadline is promised.

The supported access-token API has no per-token invalidation or targeted
backend socket-eviction operation. Changing room ACLs or adding webhooks does
not revoke permissions embedded in an access token. Cooperative client
logout can clear that client's cache, but cannot invalidate a copied token.
Immediate eviction would require a separately designed and verified provider
authorisation model, not a claim made by this integration.

Sources pinned to v3.24.1:
[token issuance](https://github.com/liveblocks/liveblocks/blob/v3.24.1/packages/liveblocks-node/src/Session.ts),
[client authentication cache](https://github.com/liveblocks/liveblocks/blob/v3.24.1/packages/liveblocks-core/src/auth-manager.ts),
[connection handling](https://github.com/liveblocks/liveblocks/blob/v3.24.1/packages/liveblocks-core/src/connection.ts).

## Permission matrix

Sheetbase is authoritative; React-side hiding of controls is never the
boundary — the server-issued scopes are.

Active, writable object, after canonical View has been granted. Writer rows
also require current Edit; without Edit they receive the viewer scopes:

| Who                                                            | Connect | Read presence/threads | Create/reply/resolve/reopen |
| -------------------------------------------------------------- | ------- | --------------------- | --------------------------- |
| owner/admin/member/steward/scientist/analyst/reviewer (active) | yes     | yes                   | yes                         |
| viewer (GOV-01 read-only)                                      | yes     | yes                   | no                          |
| suspended member                                               | no      | no                    | no                          |
| non-member / cross-workspace                                   | no      | no                    | no                          |
| suspended/archived workspace                                   | no      | no                    | no                          |

Final grant = role capability × current authority × object lifecycle:

| Object lifecycle                                                   | Writer receives      | Viewer receives |
| ------------------------------------------------------------------ | -------------------- | --------------- |
| writable (`lifecycle='active'`, not locked/deleted)                | `comments:write`     | `comments:read` |
| archived record / sheet instance / dataset; locked (signed) record | `comments:read` only | `comments:read` |
| soft-deleted record (`deleted_at`) or unknown id                   | denied outright      | denied outright |

Archived/locked objects therefore become collaboration-read-only for
everyone, enforced by the minted token rather than UI hiding.

Mention suggestions (`GET /api/collaboration/mentions`) require room read
authority for both the caller and each suggested recipient. The 20-result
limit applies after authority filtering, so inaccessible members cannot fill
the result window. This protects suggestions, not arbitrary mention IDs sent
directly to Liveblocks by a client already holding a write token. User resolution
(`/resolve/users`) returns only users sharing a workspace with the caller.

## Thread anchor model (COLLAB-02)

Every thread's flat scalar metadata encodes one typed anchor from
`src/lib/collaboration/types.ts`:

- `record` — record-level discussion;
- `notebook-block` — stable block UUID (survives reorder);
- `dataset` / `dataset-row` / `dataset-field` / `dataset-cell` — dataset id +
  durable row/field UUIDs.

There are deliberately **no sheet-cell/range anchors in this release**. The
Sheet Instance model has no canonical per-row persisted identity yet, and the
legacy generated `api.sheet_*` scientific tables are retired — binding a new
product feature to them was rejected in review. A queued follow-up task
("Canonical Sheet stable row identity + Sheet-cell collaboration anchors")
adds the row identity to the Sheet Instance model first; sheet rooms carry
presence only until then. The anchor contract rejects retired kinds outright.

Anchors never contain visible row numbers, column labels, titles, DOM
coordinates or content-derived hashes, so comments stay attached across
edit/reorder/rename. Deleted or archived anchor targets render an honest
unavailable/historical state rather than silently disappearing the discussion.

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
are resolved server-side by `/api/collaboration/resolve/rooms`, which returns
names/urls only for rooms the caller can access; inaccessible rooms are
omitted from fresh responses. Previously delivered names and Liveblocks-managed
notifications are not erased by access loss. Read/unread state is
Liveblocks-managed. Email delivery is intentionally out of scope.

## Review coordination (COLLAB-04)

Reviewer assignment, review state, decisions, signatures and evidence remain
exactly as shipped (review_submissions / review RPCs). Liveblocks adds only
awareness (who is viewing the review) and coordination UX around it. Liveblocks
threads are **not** part of any signed/frozen revision evidence unless a future,
explicit evidence-capture feature says so.

## Retention and deletion

- Archived objects become read-only and their rooms grant read-only scopes to
  everyone (enforced by the token mint); existing comments stay visible as
  collaboration context and are **not** silently deleted.
- Soft-deleted records lose room access entirely.
- Project/workspace deletion should delete corresponding rooms
  (`workspace:<wsId>:*` patterns) via the Liveblocks REST API; the deletion
  flows currently live outside the app (operational), so room cleanup is an
  operator step until a first-party deletion flow exists.
- User access loss blocks future token issuance (see revocation boundary); historical
  authored comments keep their author id and render through permission-filtered
  user resolution.

## Authority regression tests

`pnpm test:db collaboration-authority` exercises the actual server resolvers
against a freshly migrated PostgreSQL database. Only session identity is
substituted. It covers forbidden projects, private drafts and parent notebooks,
workspace isolation, View-only writers, viewers, archived and locked objects,
deletion, and fresh grants after revocation. It does not exercise hosted
Liveblocks token expiry, existing sockets, or provider notification delivery.

# 0028. File records and the object-storage boundary

- **Status:** accepted
- **Date:** 2026-07-21
- **Ticket:** SCI-003

## Context

ADR 0015 anticipated `file` twice: as a future `records.kind` value ("new
kinds are added by widening the check, not by adding tables") and as a notebook
block type whose payload carries "file attachment metadata (name, size, mime,
object-storage key); the bytes live behind an object-storage boundary (deferred
to Phase 5)." ADR 0026 reaffirmed that "future kinds (datasets, analyses,
files) widen the same check and reuse the same property mechanism without new
tables." `record_links.link_type` already admits `file`. The `blocks.type`
check already admits `file`, with a placeholder payload validator.

ROADMAP line 160 names "the file and instrument-data storage boundary before
attachments" as a deliberately deferred decision now ready to be made. SCI-003
must make it.

The existing same-origin `/api/db` proxy (`handleProxyRequest`) buffers every
non-GET/HEAD request with `await request.text()` and advertises
`accept: application/json`. It has no explicit body-size limit and is not
byte-preserving. It is therefore the wrong boundary for unbounded file bytes.
File metadata, however, is small JSON and belongs exactly there.

SCI-003 must not introduce a parallel identity, permission, link, event, or
audit system. It must reuse `records`, `record_links`, `blocks`, RLS,
`change_events`, and the `/api/db` boundary where they are sufficient, and add
the smallest new machinery only where they are not.

## Decision

### 1. `file` is a record kind; storage metadata is a 1:1 `file_objects` table

`file` is added to `records.kind` (widening the check) and to the
`create_record` kind→prefix map with prefix `FILE`. A file record carries
stable UUID identity, the stable human-facing identifier `FILE-YYYY-NNNN`,
workspace + project ownership, configurable properties (via the existing
`record_field_definitions` mechanism, for instrument-specific metadata),
`record_links` linkage, archive, revision, RLS, change events and audit
attribution — all inherited from the existing record infrastructure.

Universal storage-boundary metadata is **not** configurable property JSON. It
is real, queryable, constraint-bearing columns on a new `api.file_objects`
table, owned 1:1 by a `file` record:

| column                                     | purpose                                                      |
| ------------------------------------------ | ------------------------------------------------------------ |
| `id`                                       | uuid PK                                                      |
| `workspace_id`                             | workspace ownership (matches the file record)                |
| `record_id`                                | unique FK to `records.id` (`file` kind), `ON DELETE CASCADE` |
| `storage_key`                              | server-generated, unique, independent of user filename       |
| `display_name`                             | untrusted client filename, display only                      |
| `media_type`                               | validated against the allowed-media-type check               |
| `byte_size`                                | validated `BETWEEN 0 AND 104857600` (100 MiB)                |
| `checksum`                                 | content hash                                                 |
| `checksum_algorithm`                       | currently `sha256`                                           |
| `status`                                   | `active` \| `quarantined` \| `deleted` \| `missing`          |
| `status_reason`                            | free-text reason for a non-active state                      |
| `quarantined_at`, `deleted_at`             | lifecycle timestamps                                         |
| `storage_backend`                          | `local` (dev) or `s3` (production)                           |
| `created_by_user_id`, `updated_by_user_id` | actor attribution                                            |
| `created_at`, `updated_at`                 | timestamps                                                   |

`storage_key` is generated server-side as
`<workspace_id>/<file_object_id>/<random32hex>` and is the only reference to
the bytes. `display_name` is never used as the storage key and is treated as
untrusted metadata (sanitised for display, never executed or path-joined).

### 2. Initial object-storage service and local-development substitute

**Initial service (implemented and tested):** a filesystem-backed
`ObjectStorage` implementation rooted at `FILE_STORAGE_DIR` (defaults to
`./.storage/objects`). This is the initial object-storage service for **both**
local development and initial single-node production deployments — it needs no
external cloud credentials and works inside this orb. Upload and download are
authenticated, streamed, size-bounded server routes — bytes are piped between
the client and the filesystem in fixed-size chunks and the running byte count
is checked against the cap on every chunk, so an oversized upload is aborted
before the file is materialised. The whole file is never held in application
memory as a single buffer.

**Future production target (documented, not yet wired):** any S3-compatible
object storage (AWS S3, Cloudflare R2, MinIO, etc.) addressed through the same
`ObjectStorage` interface. Uploads and downloads will use presigned URLs with
bounded conditions (`Content-Length-Range: 0,104857600` and an allowed
`Content-Type`); the application server will mint short-lived presigned URLs
and finalize metadata after the object is written, never copying unbounded file
bytes into its own memory. The `storage_backend` column already accepts `s3`,
and requesting `FILE_STORAGE_BACKEND=s3` fails fast with a clear error rather
than silently falling back to the local backend. Wiring the S3 implementation is
a later ticket; the interface contract is stable so the switch is
configuration-plus-implementation, not a schema change.

The storage key is backend-independent and never derived from a user filename.

### 3. Upload is authenticated, bounded, and never proxies through `/api/db`

Upload is a two-phase, authenticated flow:

1. **Authorize** (`POST /api/files/upload-authorize`, session-authenticated):
   the client sends proposed `displayName`, `mediaType`, `byteSize`, and
   optional `checksum`. The server validates the type/size policy, generates a
   storage key and file-object UUID, then calls the transactional
   `create_file_upload` RPC which atomically creates the `file` record (kind
   `file`, via `create_record`) and the `file_objects` row (status `missing`
   while the upload is pending, with byte size and checksum recorded as
   claimed). A metadata
   failure rolls back the record insert — no orphan file records. It returns
   `{ fileRecordId, fileIdentifier, fileObjectId, storageKey, uploadUrl,
maxBytes }`. For the local backend `uploadUrl` is the same-origin
   `/api/files/{fileRecordId}/upload`; for S3 it will be a presigned PUT URL
   with bounded conditions.
2. **Write bytes** (`PUT /api/files/{fileId}/upload` for local, or the
   presigned URL for S3): the client streams the bytes. The local endpoint
   streams to a fresh storage key in chunks, accumulates the sha256, and
   aborts with `413` if the running size exceeds the cap. On completion it
   verifies the sha256 against the claimed checksum (mismatch → `409`) and
   atomically swaps the unretained file row to the new key through
   `finalize_file_upload`. Existing keys are never overwritten.

REV-002 adds normalized `internal.revision_file_objects` retention rows for
every file captured by a submitted revision. Retention and upload finalization
lock the same `file_objects` row, so submission either captures the finalized
bytes or makes the upload lose the race and clean up its candidate key.
Retained storage identity, backend, checksum and size cannot change, and a
retained object cannot be deleted or moved to `missing` or `deleted`. Later
draft bytes require a newly authorised file object and storage identity.

Metadata mutations (create, quarantine, delete, restore, link) go through the
existing `/api/db` boundary as ordinary PostgREST CRUD or RPCs. Only the bytes
go through the storage-specific streaming boundary.

### 4. Allowed types and sizes are enforced at both layers

Initial allowed media types (generic scientific lab files):
`text/csv`, `text/plain`, `application/json`, `application/pdf`,
`image/png`, `image/jpeg`, `image/tiff`, `image/webp`,
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
`application/vnd.ms-excel`,
`application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
`application/vnd.openxmlformats-officedocument.presentationml.presentation`,
`application/octet-stream`.

Maximum size: `104857600` bytes (100 MiB).

The policy is enforced at the **application** boundary (authorize rejects
early with a useful error) and at the **database** boundary
(`chk_file_objects_media_type` and `chk_file_objects_byte_size` check
constraints on `file_objects`). PostgreSQL is authoritative; application
checks only improve error messages. `application/octet-stream` is admitted so
instrument binary exports are not silently rejected, but the display name and
media type are always treated as untrusted metadata.

### 5. Links and block references reuse existing machinery

- A file is linked to any record in the same workspace through the existing
  `record_links` table with `link_type = 'file'`, `target_record_id` set to
  the file record, and `target_kind = 'file'`. The existing
  `assert_record_link_same_workspace` trigger enforces same-workspace;
  `create_record_link` is reused unchanged.
- A `file` notebook block references a file record in its payload
  (`fileRecordId`) and caches display metadata (`displayName`, `mediaType`,
  `byteSize`, `status`) for honest rendering. The
  `validate_scientific_block` trigger is extended to verify that the referenced
  record exists, has kind `file`, and is in the same workspace as the owning
  record. The block is a presentation + upload affordance, not a second copy
  of file identity.

Both paths carry provenance and actor attribution through the existing
`created_by_user_id` columns and change-event triggers.

### 6. Download, missing-object, quarantined and deleted states render honestly

`GET /api/files/{fileId}/download` (session-authenticated) checks workspace
membership and `file_objects.status`:

- `active`: streams the bytes (local) or redirects to a presigned GET URL
  (S3), with `Content-Disposition: attachment; filename="<display_name>"`.
- `quarantined`: `410 Gone` with a structured body naming the reason; the UI
  renders the file as quarantined and not downloadable.
- `deleted`: `410 Gone`; the UI renders the file as deleted and not
  downloadable.
- `missing`: `404 Not Found` with a structured body stating the storage object
  is absent; the UI renders the file as missing. A background or manual
  reconcile can re-detect missing objects; the state is durable on
  `file_objects.status`.

The file block and inspector render each state in text and never render a
download control for a non-active file. A missing or deleted file does not
disappear from the notebook; it is shown honestly.

### 7. Lifecycle transitions are transactional RPCs

`create_record` (widened) + ordinary `file_objects` INSERT cover creation;
both are protected by RLS and check constraints, and both emit existing
`record.created` / `file.created` events.

`transition_file_status(p_file_id uuid, p_target_status text,
p_expected_version int, p_reason text DEFAULT NULL)` is a transactional
SECURITY-INVOKER RPC (like `transition_record_status`) for the state matrix:

- `active → quarantined` (sets `quarantined_at`, `status_reason`)
- `quarantined → active` (restore; clears `quarantined_at`)
- `active|quarantined → deleted` (sets `deleted_at`)
- `deleted → active` (restore from soft delete)
- `* → missing` (reconcile only; not client-callable for deletion)

It locks the `file_objects` row, checks the expected `version`, validates the
transition, updates `status`/timestamps/`updated_by_user_id`, and relies on the
`file_objects` change-event trigger. Hard delete of a `deleted` file is
owner-only via ordinary `DELETE` (cascade removes the file record and links).

### 8. Durable change events and audit attribution

`change_events.entity_type` is widened to admit `file`. A new
`change_event_file_objects` trigger emits `file.created`, `file.updated`,
`file.quarantined`, `file.deleted`, `file.restored` for every mutation path
(direct CRUD and the transition RPC) using the existing
`internal.emit_change_event` helper. Actor attribution (`actor_user_id`,
`actor_credential_id`, `client_id`) flows through the same JWT claim path as
every other entity. No parallel audit stream is introduced.

`change_events.operation` is widened to admit `quarantine`.

### 9. RLS remains authoritative

`file_objects` gets workspace-scoped RLS mirroring `records`:

- `SELECT`: workspace member.
- `INSERT`: workspace member, `workspace_id = current_workspace_id()`,
  `created_by_user_id = current_user_id()`.
- `UPDATE`: workspace member.
- `DELETE`: workspace owner.

Cross-workspace access is rejected at the database: the `record_links`
same-workspace trigger already rejects cross-workspace links; `file_objects`
RLS rejects cross-workspace reads and writes; the download endpoint re-checks
membership before streaming. The application checks improve errors but are not
the only boundary.

## REST resources and RPCs

| Path                                 | Method    | Purpose                                        |
| ------------------------------------ | --------- | ---------------------------------------------- |
| `/api/db/records?kind=eq.file`       | GET       | list file records (metadata)                   |
| `/api/db/file_objects`               | GET/PATCH | file storage metadata CRUD                     |
| `/api/db/rpc/create_file_upload`     | POST      | atomic file record + metadata creation         |
| `/api/db/rpc/finalize_file_upload`   | POST      | atomically publish a fresh unretained byte key |
| `/api/db/rpc/transition_file_status` | POST      | quarantine/delete/restore                      |
| `/api/db/rpc/create_record_link`     | POST      | link a record to a file                        |
| `/api/files/upload-authorize`        | POST      | authorize + create metadata, return upload URL |
| `/api/files/{fileId}/upload`         | PUT       | stream bytes to the local backend              |
| `/api/files/{fileId}/download`       | GET       | stream/redirect bytes for an active file       |

Request/response examples use placeholders, never real credentials.

```http
POST /api/files/upload-authorize
Content-Type: application/json
Cookie: <session>

{"projectId":"<uuid>","displayName":"qPCR_Run07.xlsx","mediaType":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","byteSize":13219840,"checksum":"<sha256 hex>"}

201 Created
{"fileRecordId":"<uuid>","fileIdentifier":"FILE-2025-0001","fileObjectId":"<uuid>","storageKey":"<ws>/<obj>/<rand>","uploadUrl":"/api/files/<uuid>/upload","maxBytes":104857600}
```

```http
PUT /api/files/<uuid>/upload
Cookie: <session>
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet

<bytes streamed>

200 OK
```

```http
POST /api/db/rpc/transition_file_status
Content-Type: application/json
Authorization: Bearer <jwt>

{"args":{"p_file_id":"<uuid>","p_target_status":"quarantined","p_expected_version":1,"p_reason":"suspected corruption"}}
```

## Consequences

- `file` records participate in the existing record picker/summary/linker once
  the picker's kind vocabulary is widened; no new picker is built for SCI-003.
- The `file` block payload replaces the placeholder validator with a typed
  contract that references a file record.
- The local filesystem storage dir (`./.storage`) is gitignored and never
  committed; it is disposable and recreated by seed/fixtures.
- Instrument-specific parsing, full instrument-output workflows, and
  versioned-file revisions belong to later tickets (SCI-004 onward). SCI-003
  delivers the abstraction and the honest states only.
- S3-compatible production wiring is a documented future target, not yet
  implemented. The initial object-storage service is the local filesystem
  backend for both development and initial single-node production. The
  `ObjectStorage` interface and `storage_backend` column are stable, so adding
  the S3 implementation is configuration-plus-implementation, not a schema
  change; requesting `FILE_STORAGE_BACKEND=s3` fails fast until that ticket
  lands.

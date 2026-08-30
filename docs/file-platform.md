# File & attachment platform

Files are durable scientific objects with stable identity, integrity metadata
and provenance. They are not opaque browser attachments (DATA-03). The platform
was introduced by SCI-003 (decision 0028) with submitted-revision retention
from REV-002 (migration `0038`). DATA-03 consolidates it as the one canonical
file subsystem.

## Model

A file is a pair of rows that share one identity:

| Row                         | Carries                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `api.records` (`kind=file`) | Public identity (`FILE-YYYY-NNNN` identifier), project, ownership, links, tags, audit trail, RLS workspace scope |
| `api.file_objects`          | Storage-boundary metadata: storage key, checksum, byte size, media type, lifecycle status, backend, version      |

The bytes never touch `/api/db`, JSON columns or the database. They live
behind the `ObjectStorage` boundary (`src/lib/file-storage/index.ts`) at
`<FILE_STORAGE_DIR>/<workspaceId>/<fileObjectId>/<32-hex>`. The server
generates the storage key; the key is independent of the user filename.
`display_name` is untrusted display metadata only.

## Integrity

- **Checksums:** The platform computes a sha256 checksum while it streams
  bytes to storage. An upload fails with `409 checksum_mismatch` when the
  declared checksum does not match the uploaded bytes. The failure marks the
  object `missing`.
- **Immutability of retained evidence:** When a revision is submitted, the
  platform pins every attached file's identity, checksum and size into
  `internal.revision_file_objects`. The live `file_objects` row then becomes
  immutable (trigger `protect_retained_file_object`): nobody can swap the
  bytes, move the record to another workspace, or set status to
  `missing`/`deleted`. Later drafts need a new file identity.
- **Stable identity:** Re-uploads replace bytes through an atomic pointer
  swap (`finalize_file_upload`, optimistic `version` guard). The swap runs
  only while the file is not evidence-pinned. Checksums and storage keys stay
  stable across unrelated metadata edits such as renames.

## Upload / download

```
POST /api/files/upload-authorize   validate policy -> create_record + file_objects ('missing') atomically
PUT  /api/files/{recordId}/upload  stream bytes (64 KiB chunks), enforce cap + checksum, finalize swap
GET  /api/files/{recordId}/download  stream back with content-type + content-disposition
```

All three routes resolve the Better Auth session -> workspace membership ->
short-lived PostgREST JWT through `resolveSessionAuth`
(`src/lib/request-auth.ts`). Metadata writes go through PostgREST RPCs. This
way RLS, change events and credential attribution fire exactly once.
Cross-workspace requests fail closed with `404 not_found`: RLS hides the row,
and nothing about its existence leaks.

## Bounds and policy

| Limit             | Value                                                                                  | Enforced by                                                        |
| ----------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Max upload size   | 100 MiB                                                                                | `FILE_MAX_BYTES` (`src/lib/file-policy.ts`), DB CHECK, `413` reply |
| Media types       | allowlist (CSV, text, JSON, PDF, PNG/JPEG/TIFF/WebP, XLSX/XLS/DOCX/PPTX, octet-stream) | DB CHECK + authorize-time policy check                             |
| Storage key shape | `<uuid>/<uuid>/[0-9a-f]{32}`                                                           | DB CHECK + finalizer regex                                         |

Zero-byte uploads are valid (`byte_size BETWEEN 0 AND 104857600`). Oversize
uploads abort mid-stream. The platform removes partial objects and marks the
file object `missing`.

## Lifecycle

Status is one of `active | quarantined | deleted | missing`. Only
`transition_file_status` changes status, with optimistic version checks.
Invalid transitions fail at the database boundary. Quarantine is the natural
seam for optional malware scanning: a scanner service can drive
`active -> quarantined -> active/deleted` transitions without a platform
change. Deleted files keep their rows (`deleted_at`) for audit.

## Attachments

- **Notebooks:** a notebook `file` block references the file record id
  (`src/lib/file-attach.ts`). The platform validates block payloads against
  the live `file_objects` row.
- **Records:** typed links go through `create_record_link`
  (`link_type='file'`). The database boundary rejects cross-workspace links.
- **Datasets:** datasets are not records, so the current product model has no
  clean attachment join for them. Dataset-level attachment waits for a
  dataset linking surface; do not add a second link table here.
- **Evidence:** revision submission pins attached files (see Integrity
  above). Historical downloads keep serving pinned bytes after later draft
  churn.

## Previews

Inline image previews render for previewable media types
(`isInlinePreviewableImage`) straight from the download endpoint. All other
types show name, size, media type and live status. No thumbnail pipeline
exists yet.

## Storage abstraction

`ObjectStorage` (`putStream/getStream/head/delete`) is the only way bytes
move. `LocalFileStorage` ships today. The schema already models
`storage_backend='s3'` for a future S3-compatible implementation. No other
code in the code base touches the filesystem directly.

## Relationship to instrument raw files

`instrument_raw_files` is part of the instrument-monitor domain (run
telemetry manifests), not a second general file store. Each row can reference
the canonical platform through its optional `file_id -> file_objects` foreign
key. Or it can record an external `storage_key` for run artifacts that never
entered the platform.

## Tests

- API contract: `tests/api/file-storage.test.ts` (upload/download happy path,
  oversize, checksum mismatch, cross-workspace upload/download denial without
  existence leak, unauthenticated denial, zero-byte boundary, retention
  immutability, checksum stability across renames).
- Database/RLS: `tests/db/file-storage.test.ts` (workspace isolation, insert
  boundaries, link rejection, lifecycle transitions, change events with actor
  attribution, key/size/type constraints, transactional `create_file_upload`,
  viewer writer gate).

## Superseded paths removed

None required: SCI-003 remains the single file subsystem. The instrument
monitor's `instrument_raw_files` manifest (above) references this platform.
It does not duplicate it.

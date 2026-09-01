# File & attachment platform

DATA-03. Files are durable scientific objects with stable identity,
integrity metadata and provenance — not opaque browser attachments. The
platform was introduced by SCI-003 (decision 0028) with submitted-revision
retention from REV-002 (migration `0038`); DATA-03 consolidates it as the one
canonical file subsystem.

## Model

A file is a pair of rows that share one identity:

| Row                         | Carries                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `api.records` (`kind=file`) | Public identity (`FILE-YYYY-NNNN` identifier), project, ownership, links, tags, audit trail, RLS workspace scope |
| `api.file_objects`          | Storage-boundary metadata: storage key, checksum, byte size, media type, lifecycle status, backend, version      |

The bytes never touch `/api/db`, JSON columns or the database. They live
behind the `ObjectStorage` boundary (`src/lib/file-storage/index.ts`) at
`<FILE_STORAGE_DIR>/<workspaceId>/<fileObjectId>/<32-hex>`. The storage key is
server-generated and independent of the user filename; `display_name` is
untrusted display metadata only.

## Integrity

- **Checksums:** sha256, computed while streaming to storage. A declared
  checksum that does not match the uploaded bytes rejects the upload
  (`409 checksum_mismatch`) and marks the object `missing`.
- **Immutability of retained evidence:** when a revision is submitted, every
  attached file's identity + checksum + size are pinned into
  `internal.revision_file_objects` and the live `file_objects` row becomes
  immutable (trigger `protect_retained_file_object`): bytes cannot be swapped,
  the record cannot move workspaces, and status cannot become
  `missing`/`deleted`. Later drafts require a new file identity.
- **Stable identity:** re-uploads replace bytes through an atomic pointer swap
  (`finalize_file_upload`, optimistic `version` guard) only while the file is
  not evidence-pinned. Checksums and storage keys are stable across unrelated
  metadata edits such as renames.

## Upload / download

```
POST /api/files/upload-authorize   validate policy -> create_record + file_objects ('missing') atomically
PUT  /api/files/{recordId}/upload  stream bytes (64 KiB chunks), enforce cap + checksum, finalize swap
GET  /api/files/{recordId}/download  stream back with content-type + content-disposition
```

All three resolve the Better Auth session -> workspace membership -> short-lived
PostgREST JWT via `resolveSessionAuth`
(`src/lib/request-auth.ts`); metadata writes go through PostgREST RPCs so RLS,
change events and credential attribution fire exactly once. Cross-workspace
requests fail closed with `404 not_found`: RLS hides the row and nothing about
its existence leaks.

## Bounds and policy

| Limit             | Value                                                                                  | Enforced by                                                        |
| ----------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Max upload size   | 100 MiB                                                                                | `FILE_MAX_BYTES` (`src/lib/file-policy.ts`), DB CHECK, `413` reply |
| Media types       | allowlist (CSV, text, JSON, PDF, PNG/JPEG/TIFF/WebP, XLSX/XLS/DOCX/PPTX, octet-stream) | DB CHECK + authorize-time policy check                             |
| Storage key shape | `<uuid>/<uuid>/[0-9a-f]{32}`                                                           | DB CHECK + finalizer regex                                         |

Zero-byte uploads are valid (`byte_size BETWEEN 0 AND 104857600`). Oversize
uploads abort mid-stream: partial objects are removed and the file object is
marked `missing`.

## Lifecycle

`active | quarantined | deleted | missing`, transitioned only through
`transition_file_status` with optimistic version checks; invalid transitions
fail at the database boundary. Quarantine is the natural seam for optional
malware scanning: a scanner service would drive `active -> quarantined ->
active/deleted` transitions without any platform change. Deleted files keep
their rows (`deleted_at`) for audit.

## Attachments

- **Notebooks:** a notebook `file` block references the file record id
  (`src/lib/file-attach.ts`); block payloads are validated against the live
  `file_objects` row.
- **Records:** typed links via `create_record_link` (`link_type='file'`);
  cross-workspace links are rejected at the database boundary.
- **Datasets:** datasets are not records, so there is no clean attachment join
  in the current product model; dataset-level attachment waits for a dataset
  linking surface rather than inventing a second link table here.
- **Evidence:** revision submission pins attached files (see Integrity above);
  historical downloads keep serving pinned bytes after later draft churn.

## Previews

Inline image previews render for previewable media types
(`isInlinePreviewableImage`) straight from the download endpoint; all other
types show name, size, media type and live status. No thumbnail pipeline yet.

## Storage abstraction

`ObjectStorage` (`putStream/getStream/head/delete`) is the only way bytes move.
`LocalFileStorage` ships today; `storage_backend='s3'` is already modelled in
the schema for a future S3-compatible implementation. Nothing else in the code
base touches the filesystem directly.

## Relationship to instrument raw files

`instrument_raw_files` is part of the instrument-monitor domain (run telemetry
manifests), not a second general file store. Each row may reference the
canonical platform through its optional `file_id -> file_objects` foreign key,
or record an external `storage_key` for run artifacts that never entered the
platform.

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
monitor's `instrument_raw_files` manifest (above) references this platform
rather than duplicating it.

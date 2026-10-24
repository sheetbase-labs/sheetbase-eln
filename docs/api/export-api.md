# Export & portability API

DATA-02. Exports turn canonical Sheetbase objects into portable files without
weakening schema, provenance or evidence semantics. File endpoints stream
through the same-origin boundary, authenticate with the Better Auth session,
enforce workspace RLS through PostgreSQL and write a provenance receipt into
`api.data_exports`.

## Endpoints

| Endpoint                               | Formats                               | Object                          |
| -------------------------------------- | ------------------------------------- | ------------------------------- |
| `GET /api/export/dataset/$id`          | csv, tsv, json, ndjson, xlsx, parquet | Live Dataset                    |
| `GET /api/export/dataset-version/$id`  | csv, tsv, json, ndjson, xlsx, parquet | Dataset Version (frozen)        |
| `GET /api/export/sheet-instance/$id`   | json, csv, tsv, xlsx, parquet         | Sheet Instance                  |
| `GET /api/export/record/$id`           | json                                  | Record / Notebook document      |
| `GET /api/export/revision/$id/package` | zip                                   | Submitted revision evidence ZIP |
| `GET /api/export/record/$id/eln`       | .eln                                  | One experiment as an archive    |
| `GET /api/export/project/$id/eln`      | .eln                                  | All experiments in a project    |
| `POST /api/import/eln?projectId=$id`   | .eln body                             | Import experiments as drafts    |

Downloads are plain GETs: session cookies authenticate them, so an anchor or
`window.open` is enough in the browser.

## Lossless machine snapshot transfer

`POST /api/db/rpc/query_dataset_version_transfer` provides a separate, versioned
representation for integrations. Ordinary file formats and row queries keep
their existing representation, including their numerical precision limits.
The RPC accepts service credentials and personal tokens through the existing
`/api/token` exchange and same-origin proxy. Both `datasets:read` and
`schema:read` are required. Workspace membership, object access, credential
revocation, and personal-token member permissions still apply. No browser
session or new connector framework is involved.

Request:

```json
{ "p_dataset_version_id": "<uuid>", "p_limit": 1000, "p_offset": 0 }
```

`p_limit` is 1–1000 (default 1000). `p_offset` is non-negative (default 0)
and cannot exceed the snapshot row count. Pages follow ascending row UUID
order. The response has this shape:

```text
format             "sheetbase.dataset-version-transfer/1"
metadataJson       authoritative JSON text, unchanged across pages
metadataChecksum   lowercase SHA-256 hex of UTF8(metadataJson)
offset, limit      requested page window
totalCount         complete snapshot row count, not page length
hasMore            whether another page remains
rows[]             { rowId, canonicalJson, sha256 }
pageChecksum       aggregate of this page's ordered row hashes
snapshotChecksum   aggregate of all row hashes on terminal page; otherwise null
```

`metadataJson` contains workspace, Dataset, Dataset Version, schema definition,
and schema version IDs; schema version number; source Dataset revision; snapshot
label and creation time; total count; and the complete pinned schema fields.
Fields retain stable UUIDs, keys, labels, order, types, cardinality, nullability,
defaults, quantity, validation, category, relationship, computation, and lifecycle
metadata. Duplicate labels do not merge fields.

Each `canonicalJson` parses to `{rowId, revision, values, flags}`. `values` maps
field UUIDs to stored values. Many-values retain their array order. An absent
scalar is `null`; an absent many-value is `[]`. Every JSON number inside
`metadataJson` and `canonicalJson` is an exact decimal **string**, including
numbers nested in defaults, validation, and flag provenance. Boolean values
remain booleans. Consumers use the pinned field type to interpret value strings,
not JavaScript floating-point conversion. UUID category and Record references
remain UUIDs, not labels or embedded Record state.

Transfer includes all snapshot rows, values, and frozen flags; it does not apply
QC exclusions. Canonical Pipeline input instead excludes a cell with any flag
and takes the first value of a many-value cell. Dataset Versions do not capture
planned/recorded row status. Referenced Record state remains live unless separately
pinned. The response metadata records these limits.

Checksums use the supplied text bytes, **not reserialised parsed JSON**:

- Row hash: `SHA256(UTF8(canonicalJson))`.
- Page aggregate: `SHA256(UTF8(metadataChecksum + LF + ordered row hashes, each followed by LF))`.
- Snapshot aggregate: the same construction over every row in UUID order.
- Empty snapshot aggregate: `SHA256(UTF8(metadataChecksum + LF))`.

The terminal page computes the full snapshot digest with one complete server
scan. Earlier pages do not rescan the full snapshot. Paging uses offsets over
immutable rows; it is not CDC or a change feed. A consumer must verify metadata,
row, page, and final snapshot hashes and the complete unique row count before
publishing staged data atomically. An interrupted transfer must not replace a
previous successful copy. Snapshot inventory and local checksum reconciliation
are separate consumer responsibilities. A version that is deleted, pruned, or
no longer readable cannot be recovered through this endpoint. Inventory absence
is not an authoritative deletion event or permission to delete a consumer's
retained copy. RPC reads do not create file-download receipts in
`api.data_exports`.

### Snapshot reconciliation client

`scripts/sync-dataset-snapshots.ts` performs one reconciliation of the readable
Dataset Version inventory in one workspace. It uses the TypeScript SDK and
the transfer RPC, not the session-only file endpoints.

```sh
node --import tsx scripts/sync-dataset-snapshots.ts \
  --workspace <workspace-uuid> --output <local-directory>
```

The process reads `SHEETBASE_URL` and `SHEETBASE_CREDENTIAL` from its environment.
The credential needs `datasets:read` and `schema:read`. Credentials do not appear
in command arguments or output files. The output directory contains scientific
data and needs the same access and retention controls as the source workspace.

Each completed snapshot occupies `<workspace>/<dataset>/<version>/` with:

- `metadata.json`: the exact schema and provenance text supplied by the server.
- `rows.ndjson`: the exact canonical row texts, separated by newlines.
- `manifest.json`: the source URL, row count, metadata hash, and snapshot hash.

The client verifies identities, UUID order, counts, and every checksum before
renaming a hidden staging directory to the final version directory. Consumers
must ignore `.partial-*` directories. A failed run exits nonzero and does not
publish its incomplete snapshot. Previously completed versions remain intact.
A repeated run verifies existing local files before skipping those versions;
local corruption fails the run rather than silently replacing the copy.
An explicit retention error adds the version UUID to the result's `unavailable`
list and allows later versions to transfer. No directory or success manifest
is published for that version. The CLI exits with status 2 if this list is not
empty, status 1 for other failures, and status 0 for a complete reconciliation.
Permission failures, corrupt checksums, and unknown errors stop the run.

This is a single-process, local-filesystem client, not a managed lakehouse
replica. A scheduler may invoke it repeatedly, but concurrent runs against the
same output directory are unsupported. It neither creates source snapshots
nor propagates deletions. An inventory scan is not an atomic view of all
versions; later runs discover versions added during a scan. Lakehouse loading,
destination access controls, scheduling, and retention remain operator-owned.

## Live state versus frozen evidence

Exports distinguish the two explicitly:

- **Live exports** (`_meta.state = "live"`) reflect mutable workspace state as
  of one unchanged Dataset revision. A revision or schema change during paging
  aborts the export. Their metadata carries the note: _This file is NOT
  immutable evidence._
- **Dataset Version exports** (`state = "version"`) read only the frozen copy
  captured by `snapshot_dataset`. Mutating the live dataset afterwards does not
  change a version export — this is proven by test.
- **Revision evidence packages** bundle one submitted revision: the immutable
  REV-002 envelope, its frozen Sheet grids, the pinned attachment manifest and
  the review/signature trail.

## Determinism

Machine-readable exports are deterministic: identical inputs produce identical
bytes. Wall-clock timestamps are deliberately excluded from file content —
export provenance (who/when/format) lives in `api.data_exports` receipts and in
the response headers instead. Decimal values inherit the canonical Dataset
contract's JSON number encoding; precision beyond IEEE double (~15 significant
digits) is rounded by that encoding, which is a documented boundary of reading
through `query_dataset_rows` rather than raw tables.

### Metadata envelope

JSON and XLSX exports embed `_meta` / a Metadata sheet:

```
kind            sheetbase.dataset.export | sheetbase.dataset-version.export | ...
state           live | version | evidence
objectId        stable object id
workspaceId     owning workspace
name            object name at export time
sourceRevision  dataset revision backing the rows
datasetVersion  { datasetVersionId, sourceDatasetRevision, label, schemaVersionId }
schema[]        { key, label, logicalType, nullable, unit }
notes[]         live/version statement
```

CSV/TSV stay pure data (headers only); units and schema travel in the JSON,
NDJSON companion or the XLSX Metadata sheet. Category and reference cells keep
their stable option/target ids — labels are presentation, ids are identity.

## Streaming and bounds

- CSV/TSV/JSON/NDJSON render line-by-line while paging the canonical RPCs
  (`query_dataset_rows`, `query_dataset_version_rows`, 1000-row windows), so
  memory stays bounded regardless of dataset size.
- XLSX materialises worksheet XML per sheet (bounded by the export itself).
- Parquet materialises column arrays and is capped at `PARQUET_MAX_ROWS`
  (200,000); larger datasets must use CSV/NDJSON.
- Evidence ZIPs buffer one entry at a time; entries derive from already-frozen
  revision content.

## Evidence package layout

```
evidence-<revisionId>.zip
├── README.md                  how to read the package
├── evidence.json              full machine-readable evidence document
├── grids/<blockId>.csv        frozen Sheet grid render per submitted block
├── files/files-manifest.csv   pinned attachments with sha256 checksums
└── checksums.sha256           sha256sum -c compatible manifest
```

The JSON document contains the revision identity and REV-002 integrity digest,
metadata/block snapshots, `canonicalSnapshot`, per-block Sheet evidence
(instance state, composed grid, pinned Dataset Version bindings), the retained
file manifest from `internal.revision_file_objects`, and the review/signature
trail (submission, decisions, check results, signatures, comments). It is
produced exclusively by `api.revision_evidence_package` — the SIGN-002
`export_revision_evidence` RPC was consolidated into it and removed.

## Permissions and failure modes

Authorization stays in PostgreSQL: metadata reads and data pages run through
RLS under the caller's short-lived JWT, so an inaccessible object is
indistinguishable from a missing one (`404 not_found`, no existence leak).
Unauthenticated requests get `401`; malformed formats get `400`; Parquet over
the row cap gets `413`.

Receipts are authoritative and server-owned. Request roles hold no INSERT
grant on `api.data_exports` and no receipt-writer RPC is callable through
`/api/db`; receipts are written exclusively by the export routes over the
application's own database connection, deriving `workspace_id` and
`actor_user_id` from the verified Better Auth session. Fabricating or
reattributing an audit row would require server compromise, not a crafted
HTTP call.

A receipt is part of the successful-export contract: it persists once the
export content has been generated (for streams, before the footer and close)
with the exact number of generated rows. A schema, page, revision, or receipt
failure aborts the export. A streamed response may already have sent its HTTP
headers and some bytes; consumers must reject an interrupted body. A receipt
records generation, not proof of client delivery. Generation failures leave
no receipt. Because export is a read-plane
action, plain unsuspended workspace membership gates the receipt RPC —
workspace `viewer` accounts may export data they can read while the system
records the action on their behalf.

## Superseded paths removed

- The client-side "Export CSV" of whatever rows happened to be loaded was
  replaced by server-side streaming export of complete datasets.
- The client-side evidence JSON download (`downloadRevisionEvidence` /
  `export_revision_evidence` RPC) was replaced by the evidence package; the
  same machine-readable content is now part of `evidence.json`.

## .eln archives

`.eln` is the ELN Consortium interchange format: a ZIP with one top-level
folder and an RO-Crate 1.1 `ro-crate-metadata.json`, readable by other ELNs
(eLabFTW, Chemotion, openBIS and others).

```
<name>/ro-crate-metadata.json      crate graph (root Dataset -> experiments)
<name>/<EXP-001 Title>/experiment.json   native Sheetbase notebook document
<name>/<EXP-001 Title>/files/…           attached files, with sha256 in the crate
<name>/<EXP-001 Title>/datasets/…        cited Datasets as CSV (frozen version if pinned)
<name>/<EXP-001 Title>/signatures.json   electronic signatures
<name>/<EXP-001 Title>/audit.csv         full audit history of the record
```

Each experiment is a `Dataset` entity (`identifier`, `name`, `text`,
`keywords`, `dateCreated`, status/kind as `PropertyValue`). Files and Datasets
are `File` entities with `encodingFormat`, `contentSize` and `sha256`.
Signatures are `Action` entities also typed `sheetbase:Signature`
(`https://sheetbase.io/ns/eln#`) carrying meaning, signer role, auth method,
revision id and the revision integrity digest, linked to a `Person`.

- **Authorisation.** Reads use the caller's RLS-scoped token, so a caller
  exports only what they can see; inaccessible or missing ids are `404`.
- **Receipts.** Each exported experiment writes an `api.data_exports` receipt
  (`object_type = record`, `format = eln`); a project export writes one per
  experiment. If a receipt cannot be written the export fails.
- **Limits.** At most 200 experiments per project archive (`413
too_many_experiments`) and 256 MiB of attached-file bytes per archive; files
  that are not active, are absent from storage or do not fit are left out of
  the archive rather than failing it.
- **Live, not evidence.** Like other live exports this is not immutable
  evidence; use the revision evidence package for submitted revisions.
- **Import.** `POST /api/import/eln?projectId=…` with the raw archive as the
  body (max 64 MiB) creates one `draft` experiment per crate experiment, with
  tags and rich-text blocks, plus a closing provenance paragraph naming the
  original identifier. Blocks that reference workspace objects (files, Sheets,
  Datasets, charts), attached files, signatures and audit history are **not**
  imported and are listed in `warnings`; foreign crates import their `text`.
  Entry names with `..`, absolute paths or backslashes, encrypted entries and
  ZIP64 archives are refused.

# Export & portability API

DATA-02. Exports turn canonical Sheetbase objects into portable files. They
do not weaken schema, provenance or evidence semantics. Every endpoint
streams through the same-origin boundary. It authenticates with the Better
Auth session and enforces workspace RLS through PostgreSQL. Each export
writes a provenance receipt into `api.data_exports`.

## Endpoints

| Endpoint                               | Formats                               | Object                          |
| -------------------------------------- | ------------------------------------- | ------------------------------- |
| `GET /api/export/dataset/$id`          | csv, tsv, json, ndjson, xlsx, parquet | Live Dataset                    |
| `GET /api/export/dataset-version/$id`  | csv, tsv, json, ndjson, xlsx, parquet | Dataset Version (frozen)        |
| `GET /api/export/sheet-instance/$id`   | json, csv, tsv, xlsx, parquet         | Sheet Instance                  |
| `GET /api/export/record/$id`           | json                                  | Record / Notebook document      |
| `GET /api/export/revision/$id/package` | zip                                   | Submitted revision evidence ZIP |

Downloads are `GET` requests. Session cookies authenticate them, so an
anchor or `window.open` is enough in the browser.

## Live state versus frozen evidence

Exports distinguish the two states explicitly:

- **Live exports** (`_meta.state = "live"`) show the mutable workspace state
  as of the last queried page. Their metadata carries the note: _This file
  is NOT immutable evidence._
- **Dataset Version exports** (`state = "version"`) read only the frozen
  copy that `snapshot_dataset` captured. Changing the live dataset
  afterwards does not change a version export. A test proves this.
- **Revision evidence packages** bundle one submitted revision: the
  immutable REV-002 envelope, its frozen Sheet grids, the pinned attachment
  manifest and the review/signature trail.

## Determinism

Machine-readable exports are deterministic: identical inputs produce
identical bytes. File content excludes wall-clock timestamps. Export
provenance (who/when/format) lives in `api.data_exports` receipts and in
the response headers. Decimal values inherit the canonical Dataset
contract's JSON number encoding. That encoding rounds precision beyond IEEE
double (~15 significant digits). This is a documented boundary of reading
through `query_dataset_rows` rather than raw tables.

### Metadata envelope

JSON and XLSX exports embed `_meta` or a Metadata sheet:

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

CSV/TSV keep pure data (headers only). Units and schema travel in the JSON,
the NDJSON companion or the XLSX Metadata sheet. Category and reference
cells keep their stable option/target ids. Labels are presentation; ids are
identity.

## Streaming and bounds

- CSV/TSV/JSON/NDJSON render line-by-line while paging the canonical RPCs
  (`query_dataset_rows`, `query_dataset_version_rows`, 1000-row windows).
  Memory stays bounded for any dataset size.
- XLSX materialises worksheet XML per sheet (bounded by the export itself).
- Parquet materialises column arrays. The row cap is `PARQUET_MAX_ROWS`
  (200,000). Larger datasets must use CSV/NDJSON.
- Evidence ZIPs buffer one entry at a time. Entries derive from
  already-frozen revision content.

## Evidence package layout

```
evidence-<revisionId>.zip
├── README.md                  how to read the package
├── evidence.json              full machine-readable evidence document
├── grids/<blockId>.csv        frozen Sheet grid render per submitted block
├── files/files-manifest.csv   pinned attachments with sha256 checksums
└── checksums.sha256           sha256sum -c compatible manifest
```

The JSON document contains the revision identity and REV-002 integrity
digest. It also contains metadata/block snapshots, `canonicalSnapshot`, and
per-block Sheet evidence (instance state, composed grid, pinned Dataset
Version bindings). It includes the retained file manifest from
`internal.revision_file_objects` and the review/signature trail (submission,
decisions, check results, signatures, comments). `api.revision_evidence_package`
produces it exclusively. The SIGN-002 `export_revision_evidence` RPC was
consolidated into it and removed.

## Permissions and failure modes

Authorization stays in PostgreSQL: metadata reads and data pages run through
RLS under the caller's short-lived JWT. An inaccessible object is
indistinguishable from a missing one (`404 not_found`, no existence leak).
Unauthenticated requests get `401`. Malformed formats get `400`. Parquet
over the row cap gets `413`.

Receipts are authoritative and server-owned. Request roles hold no INSERT
grant on `api.data_exports`. No receipt-writer RPC is callable through
`/api/db`. The export routes write receipts exclusively over the
application's own database connection. They derive `workspace_id` and
`actor_user_id` from the verified Better Auth session. Fabricating or
reattributing an audit row would require server compromise, not a crafted
HTTP call.

A receipt is part of the successful-export contract. It persists after the
export content is generated (for streams, strictly after a successful close)
with the exact number of delivered rows. A receipt failure aborts the
export. Failed exports leave no receipt. Export is a read-plane action, so
plain unsuspended workspace membership gates the receipt RPC. Workspace
`viewer` accounts may export data they can read. The system records the
action on their behalf.

## Superseded paths removed

- Server-side streaming export of complete datasets replaced the
  client-side "Export CSV" of whatever rows happened to be loaded.
- The evidence package replaced the client-side evidence JSON download
  (`downloadRevisionEvidence` / `export_revision_evidence` RPC). The same
  machine-readable content is now part of `evidence.json`.
